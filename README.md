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


## addPoi( 'name', 'here, there', instrumentedImplementation)
addPoi registers a Point of Interest" (POI) in the program.
POIs are functions which can mark certain points in the execution
by calling light-weight "marker" functions. When nobody is subscribed,
these functions evaluate only two conditionals before exiting.
The marker functions return a promise which can be awaited,
this creates a one-shot execution stop if someone is subscribed to
a marker while it is called, otherwise it continues immediately.
Here is an example of a class which has its "addNumbers" method
registered as a point of interest:,

class SpecialClass {
    constructor(private a: number, private b: number) {}

    addNumbers = addPoi('addNumbers', 'before, after', ({before, after})=>
        async (c: number)=>{
            await before( s=>eval(s));
            this.a += b+c;
            await after( s=>eval(s) );
            return this.a;
        });
}

const sc = new SpecialClass(1,2);
const veryImportantResult = await sc.addNumbers(3);

Note how the before and after names from the string are available
as keys on the object passed as the first argument to the first callback,
the value of these is a function which returns a promise (for suspending execution if needed)
and takes a callback which should should take a string and evalate it, to allow execution in the local context.

In the "before" marker, the three variables are exposed.

The markers can then be "subscribed" to, meaning the promise will suspend execution until
values have been inspected/modified and I want to continue running the rest of the code.
In contrast to a traditional breakpoint, this does not suspend the process, the program is running WHILE this
single path is suspended, meaning other clients may be served by as server while I intercept a single call.


## delPoi( poi )
The function takes the function returned by addPoi and unregisters it.
Useful for instrumenting medium-lived methods without leaking memory.

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
DBGRPL_NO_STDIO=true       - Never open REPL on stdin/out (default: false)
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
.fp is for interacting with fProxies created with fProx()
.sp is for interacting with sPois created with sPoi()

.poi is for interacting with POIs created with addPoi()
.track and .prox is for interacting with the pois marked (function)

.str NAME stringifies the value of the name (function source code, object json, whatever)
.from SRC DST is only available when using the wsClient, it reads the value of SRC, sends it wsClient which writes it as a file on
the local filesystem and watches that files for changes, when the file changes, it sends it back to the debugRepl which evaluates
it and sets DST to be its value.


It's late
=========
Maybe more documentation at some later point in time.