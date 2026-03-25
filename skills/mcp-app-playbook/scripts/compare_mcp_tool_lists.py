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
            "body": extract_json(body),
        }


def fetch_tool_names(url: str, protocol_version: str, client_name: str, timeout: int):
    init = call(
        url,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": protocol_version,
                "capabilities": {},
                "clientInfo": {"name": client_name, "version": "1.0"},
            },
        },
        timeout=timeout,
    )
    transport_id = init["transport_session_id"]
    if transport_id:
        call(url, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, session_id=transport_id, timeout=timeout)
    tools = call(url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id=transport_id, timeout=timeout)
    names = sorted(tool["name"] for tool in tools["body"]["result"]["tools"])
    if transport_id:
        call(url, None, session_id=transport_id, method="DELETE", timeout=timeout)
    return names


def main():
    parser = argparse.ArgumentParser(description="Compare tool lists across two MCP endpoints.")
    parser.add_argument("--left-url", required=True)
    parser.add_argument("--right-url", required=True)
    parser.add_argument("--protocol-version", default="2024-11-05")
    parser.add_argument("--client-name", default="mcp-tool-list-compare")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--fail-on-diff", action="store_true")
    args = parser.parse_args()

    try:
        left = fetch_tool_names(args.left_url, args.protocol_version, args.client_name, args.timeout)
        right = fetch_tool_names(args.right_url, args.protocol_version, args.client_name, args.timeout)
        shared = sorted(set(left) & set(right))
        left_only = sorted(set(left) - set(right))
        right_only = sorted(set(right) - set(left))
        result = {
            "left_url": args.left_url,
            "right_url": args.right_url,
            "left_count": len(left),
            "right_count": len(right),
            "shared": shared,
            "left_only": left_only,
            "right_only": right_only,
        }
        print(json.dumps(result, indent=2))
        if args.fail_on_diff and (left_only or right_only):
            sys.exit(1)
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
