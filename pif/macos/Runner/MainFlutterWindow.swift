import Cocoa
import FlutterMacOS
import Security
import LocalAuthentication

class MainFlutterWindow: NSWindow {
  private var github: PifGithubConnection?
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    // The docking shell's clamps assume a livable minimum surface; keep
    // macOS from shrinking the window into the danger zone.
    self.contentMinSize = NSSize(width: 720, height: 480)

    RegisterGeneratedPlugins(registry: flutterViewController)
    github = PifGithubConnection(messenger: flutterViewController.engine.binaryMessenger)

    super.awakeFromNib()
  }
}

/// The only owner of GitHub credentials. Neither Dart nor the hub can read a
/// saved token; the deliberately small gh command vocabulary is the only use.
private final class PifGithubConnection {
  private let channel: FlutterMethodChannel
  private let queue = DispatchQueue(label: "pif.github.credentials")
  private let lock = NSLock()
  private var selected: String?
  private var generation = 0
  private var validated: [String: [String: Any]] = [:]
  private let host = "github.com"

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "pif/github", binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, reply in
      guard let self = self else { return }
      guard let input = call.arguments as? [String: Any],
            let rawID = input["environmentId"] as? String,
            let uuid = UUID(uuidString: rawID),
            let workspace = input["workspace"] as? String, workspace.hasPrefix("/") else {
        reply(self.failure("environment_required", "Select or create a local environment first.")); return
      }
      let id = uuid.uuidString.lowercased()
      let scope = id + ":" + workspace
      self.lock.lock()
      if call.method == "selectEnvironment" {
        self.selected = scope
        self.generation += 1
      }
      let revision = self.generation
      let isSelected = self.selected == scope
      self.lock.unlock()
      guard isSelected else {
        reply(self.failure("environment_changed", "The selected environment changed. Try again.")); return
      }
      self.queue.async {
        let response: [String: Any]
        do {
          try self.assertSelected(scope, revision)
          try self.assertIdentity(id, workspace)
          response = try self.perform(call.method, input, id, workspace, scope, revision)
        } catch let error as GithubFailure {
          var state = self.validated[id] ?? ["saved": false, "validated": false]
          if error.code.hasPrefix("secure_store_") {
            state["validated"] = false
            state["canCreateRepository"] = false
            state["canCreatePrivateRepository"] = false
          }
          state.merge(self.failure(error.code, error.message)) { _, new in new }
          response = state
        } catch {
          response = self.failure("unavailable", "GitHub connection is unavailable. Try again.")
        }
        DispatchQueue.main.async { reply(response) }
      }
    }
  }

  private struct GithubFailure: Error { let code: String; let message: String }
  private func failure(_ code: String, _ message: String) -> [String: Any] {
    ["ok": false, "code": code, "message": message, "status": 1, "stdout": "", "stderr": message,
     "needsAuthorization": code == "secure_store_authorization_required" || code == "secure_store_denied"]
  }
  private func assertSelected(_ scope: String, _ revision: Int) throws {
    lock.lock(); defer { lock.unlock() }
    guard selected == scope && generation == revision else {
      throw GithubFailure(code: "environment_changed", message: "The selected environment changed. Try again.")
    }
  }
  private func assertIdentity(_ id: String, _ workspace: String) throws {
    let root = URL(fileURLWithPath: workspace).resolvingSymlinksInPath().standardizedFileURL
    let identity = root.appendingPathComponent(".pi/pif/environment.json")
    guard root.path == workspace, identity.resolvingSymlinksInPath().path == identity.path,
          let attributes = try? FileManager.default.attributesOfItem(atPath: identity.path),
          attributes[.type] as? FileAttributeType == .typeRegular,
          let size = attributes[.size] as? NSNumber, size.intValue <= 16 * 1024,
          let data = try? Data(contentsOf: identity),
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let schema = value["schemaVersion"] as? NSNumber, CFGetTypeID(schema) != CFBooleanGetTypeID(), schema == 1,
          let storedID = value["id"] as? String, storedID == id,
          storedID.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil,
          let builderVersion = value["builderVersion"] as? String, !builderVersion.isEmpty,
          let resources = value["resources"] as? [String: Any], resources["app"] as? String == "pif", resources["kit"] as? String == ".pif/builder" else {
      throw GithubFailure(code: "environment_required", message: "This folder has no valid matching local environment identity. Reopen it or restore its original environment.json first.")
    }
  }
  private func key(_ id: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: "com.pif.github.\(id)",
     kSecAttrAccount as String: host,
     kSecAttrSynchronizable as String: false]
  }
  private func keychainFailure(_ status: OSStatus) -> GithubFailure {
    switch status {
    case errSecInteractionNotAllowed:
      return GithubFailure(code: "secure_store_authorization_required", message: "GitHub needs Keychain authorization. Choose Validate in Settings and allow macOS access; unlock your login keychain if needed. The saved token is unchanged.")
    case errSecAuthFailed:
      return GithubFailure(code: "secure_store_denied", message: "Keychain access was denied. Choose Validate in Settings to authorize this app, or unlock your login keychain. The saved token is unchanged.")
    case errSecUserCanceled:
      return GithubFailure(code: "secure_store_denied", message: "Keychain authorization was cancelled. Choose Validate in Settings to try again. The saved token is unchanged.")
    default:
      return GithubFailure(code: "secure_store_unavailable", message: "Keychain is unavailable. The saved token is unchanged; no file fallback is used.")
    }
  }
  private func accessQuery(_ id: String, _ context: LAContext) -> [String: Any] {
    var query = key(id)
    query[kSecUseAuthenticationContext as String] = context
    return query
  }
  private func credential(_ id: String, _ context: LAContext) throws -> [String: Any]? {
    var query = accessQuery(id, context)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw keychainFailure(status) }
    guard let data = item as? Data,
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          value["token"] is String else {
      throw GithubFailure(code: "secure_store_invalid", message: "The saved connection cannot be read. Replace or remove its token in Settings.")
    }
    return value
  }
  private func save(_ value: [String: Any], _ id: String, _ context: LAContext) throws {
    let data = try JSONSerialization.data(withJSONObject: value)
    // Update is atomic. Never delete the working token before replacing it.
    let status = SecItemUpdate(accessQuery(id, context) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw keychainFailure(status) }
    var item = accessQuery(id, context)
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let added = SecItemAdd(item as CFDictionary, nil)
    guard added == errSecSuccess else { throw keychainFailure(added) }
  }
  private func state(_ record: [String: Any]?, _ live: Bool = false) -> [String: Any] {
    guard let record = record else {
      return ["ok": true, "saved": false, "validated": false, "code": "missing_token", "message": "Save a token for this environment to connect GitHub.", "canCreateRepository": false]
    }
    let capability = record["creationCapability"] as? String ?? "unknown"
    return ["ok": true, "saved": true, "validated": live,
            "account": record["account"] as? String ?? "",
            "creationCapability": capability,
            "canCreateRepository": live && capability != "insufficient",
            "canCreatePrivateRepository": live && capability != "insufficient" && capability != "public_only",
            "code": live ? "connected" : "saved",
            "message": live ? (capability == "unknown" ? "Account verified. Repository creation permissions will be checked by GitHub when you create." : capability == "insufficient" ? "Account verified. This token needs repo or public_repo scope to create repositories." : capability == "public_only" ? "Account verified. This token can create public repositories; private repositories require repo scope." : "Account verified. Repository and organization access is checked for each request.") : "Token saved in Keychain. Validate to check current account access."]
  }
  private func perform(_ method: String, _ input: [String: Any], _ id: String, _ workspace: String, _ scope: String, _ revision: Int) throws -> [String: Any] {
    // Only explicit credential actions may ask macOS to authorize this app
    // after a rebuild/signature change. Background status and tracker requests
    // never trigger a prompt. This policy is not controllable by request data.
    let context = LAContext()
    context.interactionNotAllowed = !["saveAndValidate", "validate", "remove"].contains(method)
    context.localizedReason = "Access the GitHub connection saved for this pif environment."
    defer { context.invalidate() }
    switch method {
    case "selectEnvironment", "status":
      let result = state(try credential(id, context))
      validated[id] = result
      return result
    case "remove":
      try assertSelected(scope, revision)
      let status = SecItemDelete(accessQuery(id, context) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw keychainFailure(status) }
      let result = state(nil); validated[id] = result; return result
    case "saveAndValidate", "validate":
      let previous = try credential(id, context)
      if validated[id] == nil { validated[id] = state(previous) }
      let token: String
      if method == "saveAndValidate" {
        token = (input["token"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard token.range(of: "^[A-Za-z0-9_]{20,255}$", options: .regularExpression) != nil else {
          throw GithubFailure(code: "invalid_token", message: "Enter a valid GitHub personal access token. The saved token is unchanged.")
        }
      } else {
        guard let saved = previous?["token"] as? String else { return state(nil) }
        token = saved
      }
      let record: [String: Any]
      do { record = try validateToken(token) }
      catch {
        if method == "validate" { validated[id] = state(previous) }
        throw error
      }
      try assertSelected(scope, revision)
      if method == "saveAndValidate" { try save(record, id, context) }
      let result = state(record, true); validated[id] = result; return result
    case "run":
      guard let record = try credential(id, context), let token = record["token"] as? String else {
        throw GithubFailure(code: "missing_token", message: "Save a GitHub token in Settings for this environment first.")
      }
      guard let args = input["args"] as? [String] else { throw unsupported() }
      let body = input["input"] as? String
      try authorize(args, body, record, workspace)
      try assertSelected(scope, revision)
      let output = try gh(args, token, input: body)
      try assertSelected(scope, revision)
      return ["ok": true, "status": 0, "stdout": output.replacingOccurrences(of: token, with: "[redacted]"), "stderr": ""]
    default: throw unsupported()
    }
  }
  private func unsupported() -> GithubFailure {
    GithubFailure(code: "unsupported_operation", message: "This GitHub operation is not supported by the environment connection.")
  }
  private func validateToken(_ token: String) throws -> [String: Any] {
    let output = try gh(["api", "--include", "--hostname", host, "user"], token)
    let normalized = output.replacingOccurrences(of: "\r\n", with: "\n")
    guard let split = normalized.range(of: "\n\n"),
          let data = normalized[split.upperBound...].data(using: .utf8),
          let user = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let login = user["login"] as? String,
          login.range(of: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$", options: .regularExpression) != nil else {
      throw GithubFailure(code: "invalid_response", message: "GitHub returned an unreadable account response. Try again.")
    }
    let scopeHeader = normalized[..<split.lowerBound].split(separator: "\n").first { $0.lowercased().hasPrefix("x-oauth-scopes:") }
    let scopes = scopeHeader?.split(separator: ":", maxSplits: 1).last?.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? []
    // Fine-grained tokens do not expose their repository permissions through
    // this header (which can also be present but empty). Never infer denial.
    let capability = token.hasPrefix("github_pat_") || scopeHeader == nil ? "unknown" : scopes.contains("repo") ? "known" : scopes.contains("public_repo") ? "public_only" : "insufficient"
    return ["token": token, "account": login, "creationCapability": capability]
  }

  /// Validate the complete argv; never accept arbitrary gh api endpoints,
  /// extensions, auth commands, shell commands, file flags, or host overrides.
  private func authorize(_ args: [String], _ input: String?, _ record: [String: Any], _ workspace: String) throws {
    guard args.count >= 2, args.count <= 100, args.allSatisfy({ $0.utf8.count <= 100_000 && !$0.contains("\0") }), (input?.utf8.count ?? 0) <= 100_000 else { throw unsupported() }
    if args[0] == "issue" {
      let op = args[1]
      guard ["list", "view", "create", "edit", "close", "reopen", "delete"].contains(op), input == nil else { throw unsupported() }
      var index = 2
      if !["list", "create"].contains(op) {
        guard index < args.count, args[index].range(of: "^[1-9][0-9]{0,9}$", options: .regularExpression) != nil else { throw unsupported() }
        index += 1
      }
      let flags: [String: Set<String>] = [
        "list": ["-R", "--repo", "--state", "--limit", "--json"],
        "view": ["-R", "--repo", "--json"],
        "create": ["-R", "--repo", "--title", "--body", "--label"],
        "edit": ["-R", "--repo", "--title", "--body", "--add-label", "--remove-label"],
        "close": ["-R", "--repo"], "reopen": ["-R", "--repo"], "delete": ["-R", "--repo", "--yes"]]
      var repository: String?
      while index < args.count {
        let flag = args[index]
        guard flags[op]!.contains(flag) else { throw unsupported() }
        if flag == "--yes" { index += 1; continue }
        guard index + 1 < args.count else { throw unsupported() }
        let value = args[index + 1]
        if flag == "-R" || flag == "--repo" {
          guard repository == nil, validRepo(value) else { throw unsupported() }; repository = value
        }
        if flag == "--limit" && !(Int(value).map { (1...300).contains($0) } ?? false) { throw unsupported() }
        if flag == "--state" && !["open", "closed", "all"].contains(value) { throw unsupported() }
        if flag == "--json" && !Set(value.split(separator: ",").map(String.init)).isSubset(of: ["number", "title", "state", "labels", "updatedAt", "url", "body", "id"]) { throw unsupported() }
        index += 2
      }
      guard let repo = repository else { throw unsupported() }
      try assertOrigin(repo, workspace)
      return
    }
    guard args[0] == "api" else { throw unsupported() }
    var endpoint: String?; var method = "GET"; var usesInput = false; var index = 1
    while index < args.count {
      let arg = args[index]
      if arg == "--include" { index += 1; continue }
      if ["--hostname", "--method", "-X", "--input"].contains(arg) {
        guard index + 1 < args.count else { throw unsupported() }
        let value = args[index + 1]
        if arg == "--hostname" && value != host { throw unsupported() }
        if arg == "--method" || arg == "-X" { method = value }
        if arg == "--input" { guard value == "-", !usesInput else { throw unsupported() }; usesInput = true }
        index += 2; continue
      }
      guard !arg.hasPrefix("-"), endpoint == nil else { throw unsupported() }
      endpoint = arg.hasPrefix("/") ? String(arg.dropFirst()) : arg; index += 1
    }
    guard let endpoint = endpoint, !endpoint.contains(".."), usesInput == (input != nil) else { throw unsupported() }
    if method == "GET", input == nil {
      if endpoint == "user" { return }
      if endpoint.hasPrefix("repos/"), validRepo(String(endpoint.dropFirst(6))) { return }
      let parts = endpoint.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
      if parts.count >= 5, parts[0] == "repos", validRepo("\(parts[1])/\(parts[2])") {
        try assertOrigin("\(parts[1])/\(parts[2])", workspace)
        if parts.count == 5, parts[3] == "labels",
           parts[4].range(of: "^(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2})+$", options: .regularExpression) != nil,
           let label = parts[4].removingPercentEncoding,
           !label.isEmpty, label.utf8.count <= 100, !label.contains("/"), !label.contains("\0") { return }
        if parts[3] == "issues", parts[4].range(of: "^[1-9][0-9]{0,9}$", options: .regularExpression) != nil {
          if parts.count == 5 { return }
          if parts.count == 6, parts[5].range(of: "^sub_issues(?:\\?per_page=100&page=[1-3])?$", options: .regularExpression) != nil { return }
        }
      }
    }
    guard method == "POST", let input = input, let data = input.data(using: .utf8),
          let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw unsupported() }
    if endpoint == "user/repos" || endpoint.range(of: "^orgs/[A-Za-z0-9][A-Za-z0-9-]{0,38}/repos$", options: .regularExpression) != nil {
      guard Set(body.keys).isSubset(of: ["name", "description", "private", "has_issues"]),
            let name = body["name"] as? String, name.range(of: "^[A-Za-z0-9._-]{1,100}$", options: .regularExpression) != nil,
            body["private"] is Bool, body["has_issues"] as? Bool == true else { throw unsupported() }
      let capability = record["creationCapability"] as? String ?? "unknown"
      guard capability != "insufficient", !(capability == "public_only" && body["private"] as? Bool == true) else {
        throw GithubFailure(code: "insufficient_permissions", message: "This token does not have the scope required for the selected repository visibility. Replace it in Settings.")
      }
      return
    }
    if endpoint.range(of: "^repos/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/labels$", options: .regularExpression) != nil {
      let parts = endpoint.split(separator: "/")
      try assertOrigin("\(parts[1])/\(parts[2])", workspace)
      guard Set(body.keys).isSubset(of: ["name", "color", "description"]),
            let label = body["name"] as? String, !label.isEmpty, label.utf8.count <= 100,
            !label.contains("/"), !label.contains("\0"),
            body["color"] as? String == "ededed", body["description"] as? String == "pif tracker label" else { throw unsupported() }
      return
    }
    if endpoint.range(of: "^repos/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/issues/[1-9][0-9]{0,9}/sub_issues$", options: .regularExpression) != nil {
      let parts = endpoint.split(separator: "/")
      try assertOrigin("\(parts[1])/\(parts[2])", workspace)
      guard Set(body.keys).isSubset(of: ["sub_issue_id"]), let number = body["sub_issue_id"] as? Int, number > 0 else { throw unsupported() }
      return
    }
    throw unsupported()
  }
  private func validRepo(_ repo: String) -> Bool {
    repo.range(of: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$", options: .regularExpression) != nil && !repo.contains("..")
  }
  private func assertOrigin(_ repo: String, _ workspace: String) throws {
    let root = try process("/usr/bin/git", ["-C", workspace, "rev-parse", "--show-toplevel"], token: nil).trimmingCharacters(in: .whitespacesAndNewlines)
    guard URL(fileURLWithPath: root).resolvingSymlinksInPath().standardizedFileURL.path == workspace else {
      throw GithubFailure(code: "repository_mismatch", message: "The Git repository belongs to a parent folder. Connect this environment's own repository first.")
    }
    let result = try process("/usr/bin/git", ["-C", workspace, "remote", "get-url", "--all", "origin"], token: nil)
    let origin = result.trimmingCharacters(in: .whitespacesAndNewlines)
    let allowed = ["https://github.com/\(repo)", "git@github.com:\(repo)", "ssh://git@github.com/\(repo)"]
    guard allowed.contains(where: { origin.lowercased() == $0.lowercased() || origin.lowercased() == ($0 + ".git").lowercased() }) else {
      throw GithubFailure(code: "repository_mismatch", message: "This request does not match the selected environment's GitHub origin. Connect the repository first.")
    }
  }
  private func gh(_ args: [String], _ token: String, input: String? = nil) throws -> String {
    let bundled = Bundle.main.resourceURL?.appendingPathComponent("pi/gh").path
    let candidates = [bundled, "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].compactMap { $0 }
    guard let binary = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
      throw GithubFailure(code: "gh_missing", message: "Install GitHub CLI (gh) to use GitHub, then try again. Local environments work without it.")
    }
    return try process(binary, args, token: token, input: input)
  }
  private func process(_ executable: String, _ args: [String], token: String?, input: String? = nil) throws -> String {
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("pif-github-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: temporary) }
    let task = Process(); let out = Pipe(); let err = Pipe(); let stdin = Pipe()
    task.executableURL = URL(fileURLWithPath: executable); task.arguments = args
    task.currentDirectoryURL = temporary
    var environment = ["PATH": "/usr/bin:/bin", "HOME": temporary.path, "GH_CONFIG_DIR": temporary.path,
                       "GH_HOST": host, "GH_PROMPT_DISABLED": "1", "GH_NO_UPDATE_NOTIFIER": "1",
                       "GH_NO_EXTENSION_UPDATE_NOTIFIER": "1", "NO_COLOR": "1", "GH_PAGER": "cat",
                       "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "LANG": "en_US.UTF-8"]
    if let token = token { environment["GH_TOKEN"] = token }
    task.environment = environment
    task.standardOutput = out; task.standardError = err; task.standardInput = stdin
    do { try task.run() } catch { throw GithubFailure(code: "process_unavailable", message: "GitHub tools could not start. Check their installation and try again.") }
    let deadline = DispatchWorkItem {
      if task.isRunning {
        task.terminate()
        DispatchQueue.global().asyncAfter(deadline: .now() + 1) { if task.isRunning { kill(task.processIdentifier, SIGKILL) } }
      }
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: deadline)
    let readers = DispatchGroup(); let output = GithubOutput(); let errors = GithubOutput()
    for (pipe, buffer) in [(out, output), (err, errors)] {
      readers.enter()
      DispatchQueue.global().async {
        while true {
          let chunk = pipe.fileHandleForReading.availableData
          if chunk.isEmpty { break }
          if buffer.data.count + chunk.count > 16 * 1024 * 1024 { buffer.tooLarge = true; if task.isRunning { task.terminate() }; break }
          buffer.data.append(chunk)
        }
        readers.leave()
      }
    }
    if let input = input { stdin.fileHandleForWriting.write(Data(input.utf8)) }
    try? stdin.fileHandleForWriting.close()
    task.waitUntilExit(); deadline.cancel(); readers.wait()
    guard !output.tooLarge && !errors.tooLarge else { throw GithubFailure(code: "response_too_large", message: "GitHub returned too much data. Narrow the request and try again.") }
    let stdout = String(decoding: output.data, as: UTF8.self)
    guard task.terminationStatus == 0 else {
      let detail = (String(decoding: errors.data, as: UTF8.self) + stdout).lowercased()
      if detail.contains("401") || detail.contains("bad credentials") || detail.contains("authentication") { throw GithubFailure(code: "invalid_token", message: "The GitHub token is invalid, expired or revoked. Replace it in Settings.") }
      if detail.contains("403") || detail.contains("saml") || detail.contains("resource not accessible") { throw GithubFailure(code: "insufficient_permissions", message: "GitHub denied access. Check token repository permissions and organization approval or SSO authorization.") }
      if detail.contains("404") { throw GithubFailure(code: "not_found", message: "The repository or issue was not found, or this token cannot access it.") }
      if detail.contains("already_exists") || detail.contains("already exists") { throw GithubFailure(code: "already_exists", message: "The GitHub resource already exists. Verify it before retrying.") }
      if detail.contains("422") { throw GithubFailure(code: "conflict", message: "GitHub rejected this request. The repository name may already exist or its details may be invalid.") }
      throw GithubFailure(code: "offline", message: "GitHub could not complete the request. Check your connection and try again; a creation request may need recovery before retrying.")
    }
    return stdout
  }
  private final class GithubOutput { var data = Data(); var tooLarge = false }
}
