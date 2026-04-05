[Skip to main content](https://modelcontextprotocol.io/docs/tools/debugging#content-area)

[Model Context Protocol home page![light logo](https://mintcdn.com/mcp/2BMHnlNW5OqOohXZ/logo/light.svg?fit=max&auto=format&n=2BMHnlNW5OqOohXZ&q=85&s=a5ac61ce77858fb1ddaf6de761c39499)![dark logo](https://mintcdn.com/mcp/2BMHnlNW5OqOohXZ/logo/dark.svg?fit=max&auto=format&n=2BMHnlNW5OqOohXZ&q=85&s=1227cb7feb8344f9f6288c6b5b0a6d80)](https://modelcontextprotocol.io/)

Search...

Ctrl K

Search...

Navigation

Developer tools

Debugging

[Documentation](https://modelcontextprotocol.io/docs/getting-started/intro) [Extensions](https://modelcontextprotocol.io/extensions/overview) [Specification](https://modelcontextprotocol.io/specification/2025-11-25) [Registry](https://modelcontextprotocol.io/registry/about) [SEPs](https://modelcontextprotocol.io/seps) [Community](https://modelcontextprotocol.io/community/contributing)

On this page

- [Debugging tools overview](https://modelcontextprotocol.io/docs/tools/debugging#debugging-tools-overview)
- [Implementing logging](https://modelcontextprotocol.io/docs/tools/debugging#implementing-logging)
- [Server-side logging](https://modelcontextprotocol.io/docs/tools/debugging#server-side-logging)
- [Common issues](https://modelcontextprotocol.io/docs/tools/debugging#common-issues)
- [Working directory](https://modelcontextprotocol.io/docs/tools/debugging#working-directory)
- [Environment variables](https://modelcontextprotocol.io/docs/tools/debugging#environment-variables)
- [Server initialization](https://modelcontextprotocol.io/docs/tools/debugging#server-initialization)
- [Connection problems](https://modelcontextprotocol.io/docs/tools/debugging#connection-problems)
- [Debugging in Claude Desktop](https://modelcontextprotocol.io/docs/tools/debugging#debugging-in-claude-desktop)
- [Checking server status](https://modelcontextprotocol.io/docs/tools/debugging#checking-server-status)
- [Viewing logs](https://modelcontextprotocol.io/docs/tools/debugging#viewing-logs)
- [Using Chrome DevTools](https://modelcontextprotocol.io/docs/tools/debugging#using-chrome-devtools)
- [Debugging workflow](https://modelcontextprotocol.io/docs/tools/debugging#debugging-workflow)
- [Development cycle](https://modelcontextprotocol.io/docs/tools/debugging#development-cycle)
- [Testing changes](https://modelcontextprotocol.io/docs/tools/debugging#testing-changes)
- [Best practices](https://modelcontextprotocol.io/docs/tools/debugging#best-practices)
- [Logging strategy](https://modelcontextprotocol.io/docs/tools/debugging#logging-strategy)
- [Security considerations](https://modelcontextprotocol.io/docs/tools/debugging#security-considerations)
- [Getting help](https://modelcontextprotocol.io/docs/tools/debugging#getting-help)
- [Next steps](https://modelcontextprotocol.io/docs/tools/debugging#next-steps)

Effective debugging is essential when developing MCP servers or integrating
them with applications. This guide covers the debugging tools and approaches
available in the MCP ecosystem.

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#debugging-tools-overview)  Debugging tools overview

MCP provides several tools for debugging at different levels:

1. **[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)**: interactive, transport-agnostic
testing UI. Connect to stdio or Streamable HTTP servers, invoke
[tools](https://modelcontextprotocol.io/specification/latest/server/tools),
[prompts](https://modelcontextprotocol.io/specification/latest/server/prompts), and
[resources](https://modelcontextprotocol.io/specification/latest/server/resources), and watch the
notification stream. This should be your first stop.
2. **Server logging**: structured logs to stderr (stdio transport) or via
[`notifications/message`](https://modelcontextprotocol.io/specification/latest/server/utilities/logging#log-message-notifications)
(all transports).
3. **Client developer tools**: most MCP clients expose logs and connection
state. See [Debugging in Claude Desktop](https://modelcontextprotocol.io/docs/tools/debugging#debugging-in-claude-desktop)
below for one example, or consult your client’s documentation.

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#implementing-logging)  Implementing logging

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#server-side-logging)  Server-side logging

When building a server that uses the local
[stdio transport](https://modelcontextprotocol.io/specification/latest/basic/transports#stdio), all messages
logged to stderr (standard error) will be captured by the host application
automatically.

Local MCP servers should not log messages to stdout (standard out), as this
will interfere with protocol operation.

For servers using the
[Streamable HTTP transport](https://modelcontextprotocol.io/specification/latest/basic/transports#streamable-http),
stderr is not captured by the client. Use the log message notifications below,
your own server-side log aggregation, or standard HTTP tooling (curl, browser
DevTools Network panel) to inspect requests,
[`Mcp-Session-Id` headers](https://modelcontextprotocol.io/specification/latest/basic/transports#session-management),
and SSE streams.For all [transports](https://modelcontextprotocol.io/specification/latest/basic/transports), you can also
provide logging to the client by sending a log message notification:

Python

TypeScript

```
@server.tool()
async def my_tool(ctx: Context) -> str:
    await ctx.session.send_log_message(
        level="info",
        data="Server started successfully",
    )
    return "done"
```

MCP defines eight
[RFC 5424 severity levels](https://modelcontextprotocol.io/specification/latest/server/utilities/logging#log-levels)
(`debug` through `emergency`). Clients can adjust the minimum level at runtime
via the
[`logging/setLevel`](https://modelcontextprotocol.io/specification/latest/server/utilities/logging#setting-log-level)
request.Important events to log:

- Initialization steps
- Resource access
- Tool execution
- Error conditions
- Performance metrics

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#common-issues)  Common issues

The examples below use Claude Desktop’s
[`claude_desktop_config.json`](https://modelcontextprotocol.io/docs/develop/connect-local-servers); the same
principles apply to any stdio-based MCP client.

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#working-directory)  Working directory

When an MCP client launches a stdio server:

- The working directory for servers launched via the client’s config may be
undefined (like `/` on macOS) since the client could be started from
anywhere
- Always use absolute paths in your configuration and `.env` files to ensure
reliable operation
- For testing servers directly via command line, the working directory will be
where you run the command

For example in `claude_desktop_config.json`, use:

```
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [\
        "-y",\
        "@modelcontextprotocol/server-filesystem",\
        "/Users/username/data"\
      ]
    }
  }
}
```

Instead of relative paths like `./data`

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#environment-variables)  Environment variables

MCP servers launched over stdio inherit only a limited subset of environment
variables automatically (the exact set is platform-dependent).To override the default variables or provide your own, you can specify an
`env` key in `claude_desktop_config.json`:

```
{
  "mcpServers": {
    "myserver": {
      "command": "mcp-server-myapp",
      "env": {
        "MYAPP_API_KEY": "some_key"
      }
    }
  }
}
```

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#server-initialization)  Server initialization

Common initialization problems:

1. **Path Issues**   - Incorrect server executable path
   - Missing required files
   - Permission problems
   - Try using an absolute path for `command`
2. **Configuration Errors**   - Invalid JSON syntax
   - Missing required fields
   - Type mismatches
3. **Environment Problems**   - Missing environment variables
   - Incorrect variable values
   - Permission restrictions

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#connection-problems)  Connection problems

When servers fail to connect:

1. Check client logs
2. Verify server process is running
3. Test standalone with [Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
4. Verify
[protocol compatibility](https://modelcontextprotocol.io/specification/latest/basic/lifecycle#version-negotiation)
5. Check
[capability negotiation](https://modelcontextprotocol.io/specification/latest/basic/lifecycle#capability-negotiation):
error [`-32602`](https://modelcontextprotocol.io/specification/latest/basic/lifecycle#error-handling) is
the standard JSON-RPC “Invalid params” code and is returned in many
contexts. One common cause is a server sending
[sampling](https://modelcontextprotocol.io/specification/latest/client/sampling) or
[elicitation](https://modelcontextprotocol.io/specification/latest/client/elicitation) requests to a
client that hasn’t declared that capability. Inspect the
[`initialize` exchange](https://modelcontextprotocol.io/specification/latest/basic/lifecycle#initialization)
to verify both sides declared what you expect

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#debugging-in-claude-desktop)  Debugging in Claude Desktop

Claude Desktop is [one of many MCP clients](https://modelcontextprotocol.io/clients). It is available on
macOS and Windows.

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#checking-server-status)  Checking server status

Click the “Add files, connectors, and more” plus icon in the chat input, then
hover over the **Connectors** menu to see connected servers and available
tools.![Available MCP tools](https://mintcdn.com/mcp/zNouQwo2h8cbxlDS/images/available-mcp-tools.png?fit=max&auto=format&n=zNouQwo2h8cbxlDS&q=85&s=e2ace1ac88895a5fe30ebd8d01456bc3)

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#viewing-logs)  Viewing logs

Log files are written to:

- macOS: `~/Library/Logs/Claude`
- Windows: `%APPDATA%\Claude\logs`

macOS

Windows

```
tail -n 20 -F ~/Library/Logs/Claude/mcp*.log
```

The logs capture:

- Server connection events
- Configuration issues
- Runtime errors
- Message exchanges

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#using-chrome-devtools)  Using Chrome DevTools

Access Chrome’s developer tools inside Claude Desktop to investigate
client-side errors:

1. Create a `developer_settings.json` file with `allowDevTools` set to true:

macOS

Windows

```
echo '{"allowDevTools": true}' > ~/Library/Application\ Support/Claude/developer_settings.json
```

2. Open DevTools: `Command-Option-I` (macOS) or `Ctrl+Alt+I` (Windows)

Note: You’ll see two DevTools windows:

- Main content window
- App title bar window

Use the Console panel to inspect client-side errors.Use the Network panel to inspect:

- Message payloads
- Connection timing

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#debugging-workflow)  Debugging workflow

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#development-cycle)  Development cycle

1. Initial Development   - Use [Inspector](https://modelcontextprotocol.io/docs/tools/inspector) for basic testing
   - Implement core functionality
   - Add logging points
2. Integration Testing   - Test in your target MCP client
   - Monitor logs
   - Check error handling

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#testing-changes)  Testing changes

To test changes efficiently:

- **Configuration changes**: Restart the MCP client
- **Server code changes**: Restart the client (for Claude Desktop, fully quit
and reopen; closing the window is not enough)
- **Quick iteration**: Use [Inspector](https://modelcontextprotocol.io/docs/tools/inspector) during
development

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#best-practices)  Best practices

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#logging-strategy)  Logging strategy

1. **Structured Logging**   - Use consistent formats
   - Include context
   - Add timestamps
   - Track request IDs
2. **Error Handling**   - Log stack traces
   - Include error context
   - Track error patterns
   - Monitor recovery
3. **Performance Tracking**   - Log operation timing
   - Monitor resource usage
   - Track message sizes
   - Measure latency

### [​](https://modelcontextprotocol.io/docs/tools/debugging\#security-considerations)  Security considerations

When debugging:

1. **Sensitive Data**   - Sanitize logs
   - Protect credentials
   - Mask personal information
2. **Access Control**   - Verify permissions
   - Check authentication
   - Monitor access patterns

For a full treatment of MCP attack vectors and mitigations, see
[Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices).

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#getting-help)  Getting help

When encountering issues:

1. **First Steps**   - Check server logs
   - Test with [Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
   - Review configuration
   - Verify environment
2. **Support Channels**   - [GitHub issues](https://github.com/modelcontextprotocol/modelcontextprotocol/issues)
   - [GitHub discussions](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions)
3. **Providing Information**   - Log excerpts
   - Configuration files
   - Steps to reproduce
   - Environment details

## [​](https://modelcontextprotocol.io/docs/tools/debugging\#next-steps)  Next steps

[**MCP Inspector** \\
\\
Learn to use the MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)

[**Build an MCP server** \\
\\
Walk through building a server from scratch](https://modelcontextprotocol.io/docs/develop/build-server)

[**Connect local servers** \\
\\
Full claude\_desktop\_config.json reference and troubleshooting](https://modelcontextprotocol.io/docs/develop/connect-local-servers)

Was this page helpful?

YesNo

[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) [Example Clients](https://modelcontextprotocol.io/clients)

Ctrl+I

![Available MCP tools](https://mintcdn.com/mcp/zNouQwo2h8cbxlDS/images/available-mcp-tools.png?w=1100&fit=max&auto=format&n=zNouQwo2h8cbxlDS&q=85&s=5d7bbe45b2ae68166b10eebd8984170f)