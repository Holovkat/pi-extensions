#!/usr/bin/env python3
import argparse
import json
import sys
import urllib.error
import urllib.request


def extract_json(body: str):
    for line in body.splitlines():
        if line.startswith("data: "):
            payload = line[6:].strip()
            if payload and payload != "[DONE]":
                return json.loads(payload)
    text = body.strip()
    return json.loads(text) if text else None


def collect_session_ids(target: set[str], value):
    if value is None:
        return
    if isinstance(value, list):
        for item in value:
            collect_session_ids(target, item)
        return
    if isinstance(value, dict):
        if "sessionId" in value and isinstance(value["sessionId"], str) and value["sessionId"].strip():
            target.add(value["sessionId"].strip())
        for item in value.values():
            collect_session_ids(target, item)


def call(url: str, payload, session_id: str | None = None, method: str = "POST", timeout: int = 60):
    data = None if method == "DELETE" else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("accept", "application/json,text/event-stream")
    if method != "DELETE":
        req.add_header("content-type", "application/json")
    if session_id:
        req.add_header("mcp-session-id", session_id)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return {
            "status": resp.status,
            "transport_session_id": resp.headers.get("mcp-session-id"),
            "content_type": resp.headers.get("content-type"),
            "body": extract_json(body),
        }


def main():
    parser = argparse.ArgumentParser(description="Smoke test a streamable HTTP MCP endpoint.")
    parser.add_argument("--url", required=True, help="MCP HTTP endpoint, e.g. http://127.0.0.1:3000/mcp")
    parser.add_argument("--tool", help="Optional tool name to call after tools/list")
    parser.add_argument("--arguments", default="{}", help="JSON object string for tool arguments")
    parser.add_argument("--skip-delete", action="store_true", help="Skip DELETE cleanup")
    parser.add_argument("--client-name", default="mcp-smoke-test", help="Client name for initialize")
    parser.add_argument("--client-version", default="1.0", help="Client version for initialize")
    parser.add_argument("--protocol-version", default="2024-11-05", help="Protocol version for initialize")
    parser.add_argument("--timeout", type=int, default=60, help="HTTP timeout in seconds")
    args = parser.parse_args()

    tool_args = json.loads(args.arguments)
    session_ids = set()

    try:
        init = call(
            args.url,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": args.protocol_version,
                    "capabilities": {},
                    "clientInfo": {"name": args.client_name, "version": args.client_version},
                },
            },
            timeout=args.timeout,
        )
        transport_id = init["transport_session_id"]

        if transport_id:
            call(
                args.url,
                {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
                session_id=transport_id,
                timeout=args.timeout,
            )

        tools = call(
            args.url,
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            session_id=transport_id,
            timeout=args.timeout,
        )
        tool_names = [tool["name"] for tool in tools["body"]["result"]["tools"]]

        result = {
            "transport_session_id": transport_id,
            "tool_count": len(tool_names),
            "tool_names": tool_names,
        }

        if args.tool:
            tool_call = call(
                args.url,
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {"name": args.tool, "arguments": tool_args},
                },
                session_id=transport_id,
                timeout=args.timeout,
            )
            collect_session_ids(session_ids, tool_call["body"])
            result["tool_call"] = {
                "name": args.tool,
                "status": tool_call["status"],
                "content_type": tool_call["content_type"],
                "app_session_ids": sorted(session_ids),
                "top_level_keys": sorted((tool_call["body"] or {}).keys()),
            }

        if transport_id and not args.skip_delete:
            call(args.url, None, session_id=transport_id, method="DELETE", timeout=args.timeout)
            result["delete"] = {"status": 200}

        print(json.dumps(result, indent=2))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        print(
            json.dumps(
                {
                    "error": {
                        "status": error.code,
                        "reason": error.reason,
                        "body": body,
                    }
                },
                indent=2,
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
