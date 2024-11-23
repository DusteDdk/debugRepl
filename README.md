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

## cap({ name: value })
This makes a value available to a repl, if it's an object,
its references can be modified, changing program parameters
as it runs, this is of course also true for member functions,
but if a member function is replaced with a new one from the
local context, that uses the "this" context, remember to bind it,
alternatively, just reference the instance directly.
addCap is better for functions.


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
            await before( ()=>({a: this.a, b: this.b, c}));
            this.a += b+c;
            await after( ()=>({c, instance: this});
            return this.a;
        });
}

const sc = new SpecialClass(1,2);
const veryImportantResult = await sc.addNumbers(3);

Note how the before and after names from the string are available
as keys on the object passed as the first argument to the first callback,
the value of these is a function which returns a promise (for suspending execution if needed)
and takes a callback which should return any variables one wishes to capture from the local scope.
In the "before" marker, the three variables are exposed.
In the "after" marker, the method argument (c) is exposed along with the entire instance.
The markers can then be "subscruibed" to, meaning the promise will suspend execution until
values have been inspected/modified and I want to continue running the rest of the code.
In contrast to a traditional breakpoint, this does not suspend the process, the program is running WHILE this
single path is suspended, meaning other clients may be served by as server while I intercept a single call.


## delPoi( poi )
The function takes the function returned by addPoi and unregisters it.
Useful for instrumenting medium-lived methods without leaking memory.


Environment variables
=====================
The following variables are available to control the debugRepl behaviour.
DBGRPL_NO_STDIO=true      - Never open REPL on stdin/out
DBGRPL_NO_SOCKETS=true    - Never open websocket for REPL.
DBRPL_SOCKET_ON_BOOT=true - Start a websocket on boot.

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


It's late
=========
Maybe more documentation at some later point in time.