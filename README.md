Abashed the devil stood and felt how awful goodness is
======================================================
This unholy abomoination is based in an entirely
different philosophy than the node inspector.

Unfortunately, Javascript falls just short of the
introspection and generative affordances that would make
interactive development and metaprogramming convenient.

This library is meant as a way to create modest islands
of sanity inside my programs, and allow me to interact
with them while they run. It's not meant simply as
a part of the write-compile-test-run loop that JS/TS
leaves us stuck with. But as a way to enrich my programs
with a bit more information, and allow me at any later
time to inspect, modify and interact with my running program.


Instrumenting my program
========================
By importing the module, the debugRepl module becomes active.
The following functions are available to enrich a program.

## cap({ name: value }, options={weak:false})
This makes a value available to a repl, if it's an object,
its references can be modified, changing program parameters
as it runs, this is of course also true for member functions,
but if a member function is replaced with a new one from the
local context, that uses the "this" context, remember to bind it,
alternatively, just reference the instance directly.
addCap is better for functions.

The options object is optional, it has one key, weak, which is
false by default. If weak is true, then only a weak reference
is registered, allowing it to be garbage-collected, this means
that to access the value, the reference must be dereferenced, this
is done with the .deref() member method on such a capture, which will
return undefined if the object was garbage-collected.


## unCap(name)
Stop capturing a value (for example to avoid a memory leak)
Shouldn't be needed, it is suggested to only capture long-running
data. Or to capture an object that contains a property which can then
be set to indicate whether to capture additional values, and control this
via the REPL.

## sPoi('name', CtxInjector)
sPoi (smarter point of interest)  is another idea for breakpoints with less syntax. In contrast to addPoi, where breakpoints can
be subscribed to before their code-path has been executed, sPois only become visible when their path has been
executed at least once. They also do not support stack tracking.

## fProx('name', CtxInjector, implementation)
fProx (function proxy) is a different approach than fPois in that it is also more lightweight, but at the same time allows
capturing the scope in which the function is created. When proying a fProx function, the new implementation is compiled in the
same context as the original function, making it easier to replace original implementations with modified versions.


Environment variables
=====================
The following variables are available to control the debugRepl behaviour.
DBGRPL_STDIO_ON_BOOT=true  - Open REPL on stdin/out if output is a TTY (default: false)
DBGRPL_NO_SOCKETS=true     - Never open websocket for REPL (default: false)
DBGRPL_WS_ON_BOOT=true     - Start a websocket on boot (default: false)
DBGRPL_DISABLE_AUTH=true   - Don't validate the URL token, allow any connection (default: false)
DBGRPL_PORT=NUMBER         - Start websocket server on port NUMBER (default: 31374 )
DBGRPL_LOCALHOST_ONLY=true - Only allow websocket connections from localhost (default: false)


Using the socket
================
Debugging via websocket is practical in two scenarios:
When the process logs too much to stdout and you want to REPL in peace.
When the process runs with no interactive terminal (for example in a detached docker).
Therefore, the socket can be started in two ways, if TTY access is available:
typing .debugReplSocket will toggle the socket on and off (disconnecting any connected clients).
Otherwise, a SIGUSR1 can be sent to the node process, then the debugRepl will output the
full command one could use locally to start the client. From a remote machine, the important
part is the IP:PORT/URL address that the wsClient.js script requires as its only argument.


Getting help inside the repl
============================
Type .help

Workflows revolve around looking at pois, tracking stacks, subscribing to breaks,
messing with captured values, installing proxy functions (replacing entire POIs with
new implementation) and so on and so forth and what have you.

Repl commands
=============
.help - Shows what commands there are, any command with no parameter will show its own help text.

.fp is for interacting with function proxies (created with fProx)
.sp is for interacting with sPointOfInterests (created with sPoi)
.x shows the summary of cap()tured values and where they were registered from.

.str NAME stringifies stuff in the local (debugRepl module) context

Available with wsClient:
.from SRC DST reads the value of SRC, sends it wsClient which writes it as a file on
the local filesystem and watches that files for changes, when the file changes, it sends it back to the debugRepl which evaluates
it and sets DST to be its value.
.edit NAME INJECTOR - Extracts the variable NAME from ctx, sends to file, and evaluates back onto NAME inside context on file change.
.fp edit NAME

It's late
=========
Maybe more documentation at some later point in time.