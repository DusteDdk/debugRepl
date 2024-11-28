
import vm, { Context, runInContext } from 'node:vm';
import { randomUUID } from "crypto";
import { networkInterfaces } from 'os';
import { ReadableOptions,Readable, Writable } from "stream";
import WebSocket, { WebSocketServer } from "ws";
import repl, { REPLServer } from "node:repl";


const x: Record<string, any> = {};
const registeredMeta: Record<string, string> = {};

const authSocketUrl = ( process.env.DBGRPL_DISABLE_AUTH !== 'true');
const socketPort = parseInt(process.env.DBGRPL_PORT as string) || 31374;
const socketHost = (process.env.DBGRPL_LOCALHOST_ONLY === 'true')?'127.0.0.1':'0.0.0.0';

let socketTimeout: ReturnType<typeof setTimeout> | null = null;
let wsTimeoutMs = parseInt(process.env.DBGRPL_WS_TIMEOUT||'120') * 1000;

function resetSocketTimeout() {
    if(socketTimeout) {
        clearTimeout(socketTimeout);
    }
    socketTimeout = setTimeout(stopSocket, wsTimeoutMs);
}

// @ts-ignore
if( !WeakRef ) {
    class WeakRef {
        private obj = { debugRepl: 'No WeekRef in this runtime.'};
        constructor( any: any ) {
            console.log(this.obj);
        }
        deref() {
            return this.obj;
        }
    }
}


class CInStream extends Readable {
    private queue: any;

    constructor(options: ReadableOptions | undefined) {
        super(options);
        this.queue = [];
    }

    _read() {
        if( this.queue.length) {
            this.push( this.queue.shift());
        }
    }

    insert(data: any) {
        this.queue.push(data);
        this._read();
    }

}

class COutStream extends Writable {
    constructor(options: any, private onWrite: (data: any,encoding: string)=>void) {
        super(options);
    }

    _write(chunk: any, encoding: string, callback: ()=>void) {
        this.onWrite(chunk, encoding,)
        callback();
    }


    setRawMode() {
    }

    isTTY = true;

    rows = 24;
    columns = 80;

    resize(size: any) {
        this.rows = size.rows;
        this.columns = size.columns;
        this.emit('resize');
    }

}

interface DebugClient {
    clientNum: number
    ws: WebSocket
};

// Function proxies (new idea)
const fProxies: {[key:string]: FproxDesc} = {};

// SetPoi (new idea)
interface SPoi {
    name: string;
    stack: string;
    runInCtx: null | CtxInjector;
    breakCb: null | (()=>Promise<void>);
}

const sPois: { [key:string]: SPoi } = {};


type CtxInjector = (src: string)=>ReturnType<typeof eval>;

let clients: DebugClient[] = [];

let token = '';

let wss: WebSocketServer | null = null;

function stopSocket() {

    for(const c of clients) {
        c.ws.close();
    }

    clients=[];


    setTimeout( ()=> {
        wss?.close();
        token = '';
        wss = null;
        console.log('debugRepl: websocket stopped');
    }, 10);
}

function startSocket() {
    console.log('\n\ndebugRepl socket started:');
    if(authSocketUrl) {
        token = randomUUID();
    } else {
        console.log('  NOTE: DBGRPL_DISABLE_SOCKET_AUTH is set, accepting all connections.');
    }



    const nets = (networkInterfaces() ?? {} )as {[key:string]: any};
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (
                    (net.family === 'IPv4' || net.family === 'IPv6' ) &&
                    (socketHost === '0.0.0.0' || net.address === '127.0.0.1' || net.address === '::1')
                ) {
                    console.log(`node ${__dirname}/../bin/wsClient.js\tws://${net.address}:${socketPort}/${token}`);
            }
        }
    }
    console.log('\n');

    let clientNum=0;
    wss = new WebSocket.Server({ host: socketHost, port: socketPort });

    if(wsTimeoutMs) {
        console.log(`debugRepl: Stopping socket server after ${wsTimeoutMs/1000} seconds of inactivity.`);
        resetSocketTimeout();
    }

    wss.on('connection', (ws: WebSocket, req: Request) => {

        const sOut = (...args: any)=>{
            ws.send(JSON.stringify({b:Buffer.from( args.join(' ')+'\n', 'utf8').toString('hex')}));
        };



        const pingInterval = setInterval( ()=>{
            if(ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ping:true}));
            }
        }, 1000);
        clientNum++;
        if( authSocketUrl && req.url !== `/${token}`) {
            sOut(`Error: Invalid token.`);
            console.log(`debugRepl: Client ${clientNum} connect via invalid path ${req.url}: Closed.`);
            return ws.close();
        }

        const client = {ws, clientNum};
        clients.push(client);


        console.log(`debugRepl: Client ${clientNum} connected.`);
        ws.on('close', ()=>{
            console.log(`debugRepl: Client ${clientNum} disconnected.`);
            clearInterval(pingInterval);
            clients = clients.filter( c=>c.clientNum !== client.clientNum )

        });

        ws.on('error', (e)=>{
            console.error(`debugRepl: Client ${clientNum} error:`);
            console.error(e);
            ws.close();
        });



        sOut(`Welcome to debugRepl session ${token}`);

        const input = new CInStream(undefined);
        const output = new COutStream(undefined, (data, encoding)=>{
            ws.send(JSON.stringify({b: data.toString('hex')}));
        });


        const {r, out} = startRepl(input, output);
        r.context.meta.ws = ws;




        r.defineCommand('from', (cmd: string)=>{
            const [inName, to, toName] = cmd.split(' ');
            if(inName && to === 'to' && toName) {

                const inObj = vm.runInThisContext(inName);
                if(!inObj) {
                    out(`${inName} not found`);
                    return;
                }

                if(typeof inObj === 'object') {
                    ws.send( JSON.stringify( { toName, from: `(${JSON.stringify(inObj,null,4)})`}) );
                } else if(typeof inObj === 'function') {
                    ws.send( JSON.stringify( { toName, from: inObj.toString()}) );
                }
                setTimeout( ()=>r.displayPrompt(), 100 );

            } else {
                out('Usage: .from SRCNAME to DESTNAME - send to client file and declares DESTNAME in local context on file change (websocket only)');
                return;
            }
        });

        // .edit interval._onTimeout in x.ectx
        r.defineCommand('edit', (cmd: string)=>{
            const [inName,_ , ctxName] = cmd.split(' ');
            if(inName && _ === 'in' && ctxName) {

                const ctx = vm.runInThisContext(ctxName);
                if(!ctx || typeof ctx !== 'function') {
                    out(`CtxInjector '$ctxName' must exist and be a function`);
                    r.displayPrompt();
                    return;
                }

                const inObj = ctx(inName);
                if(!inObj) {
                    out(`${inName} not found via ${ctxName}`);
                    r.displayPrompt();
                    return;
                }

                if(typeof inObj === 'object') {
                    ws.send( JSON.stringify( { toName: inName, from: `(${JSON.stringify(inObj,null,4)})`, ctxName}) );
                } else if(typeof inObj === 'function') {
                    ws.send( JSON.stringify( { toName: inName, from: inObj.toString(), ctxName}) );
                }
                setTimeout( ()=>r.displayPrompt(), 100 );

            } else {
                out('Usage: .edit target in CtxInjector');
                return;
            }
        });



        ws.on('message', (buf)=>{

            if(socketTimeout) {
                resetSocketTimeout();
            }

            try {
                const msg = JSON.parse(buf.toString());
                if(msg.pong) {
                    return;
                }

                if(msg.size) {
                    output.resize(msg.size);
                }

                if(msg.b) {
                    const bin = Buffer.from( msg.b, 'hex' );
                    input.insert( bin );
                }

                if(msg.to) {
                    const str = msg.to;
                    const toName = msg.toName;
                    const filename = msg.fileName;
                    try {
                        if(msg.fp) {
                            const p = fProxies[toName];
                            if(!p) {
                                out(`\ndebugRepl: Got ws message for nonexisting fp ${toName}`);
                                r.displayPrompt();
                                return;
                            }
                            out(`debugRepl: Evaluating fp ${str.length} b impl in ctx ${toName}`);
                            p.setProxyImplSrc(str);
                            r.displayPrompt();
                        } else if(msg.ctxName) {

                            const tCtx = eval(msg.ctxName);
                            if(!tCtx || typeof tCtx !== 'function') {
                                out(`\ndebugRepl: Got ws message for nonexisting CtxInjector ${msg.ctxName}`);
                                r.displayPrompt();
                                return;
                            }
                            const inResult = tCtx(`${msg.toName} = ${str}`);
                            out(`\ndebugRepl: ${toName} = ${typeof inResult} from ${filename} (${str.length} b) in ${msg.ctxName}`);
                            r.displayPrompt();
                        } else {
                            const inResult = eval(str);
                            out(`\ndebugRepl: ${toName} = ${typeof inResult} from ${filename} (${str.length} b)`);
                            r.context[toName] = inResult;
                            r.displayPrompt();
                        }
                    } catch(e) {
                        out(`\ndebugRepl: Evaluation failed: ${(e as Error).message}`);
                        r.displayPrompt();
                    }
                }

            } catch(e) {
                console.error(`debugRepl: Error parsing message from ${clientNum}`);
                console.error(e);

            }
        });
    });

}


function startRepl(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {


    const r = repl.start({ useGlobal: true, prompt: 'x: ', input, output });

    const out = (...args: any)=>{
        r.output.write(args.join(' ')+'\n');
    };

    r.setupHistory('/tmp/node.repl.hist', (err: any)=>{
        if(err) {
            out('Repl history error');
        }
    });

    r.defineCommand('help', ()=>{
        out('\nDSTs debugRepl help:');
        out('  .fp       -- Function Proxy stuff.')
        out('  .sp       -- SetPointOfInterest stuff.')
        out('  .x        -- Show info about values registered with "cap()".');
        out('  .str VAR  -- Pretty JSON.stringify the variable and show it.');
        out('  .from SRCNAME DSTNAME -- Send the string representation of SRC name to file DSTNAME on socket client.');
        out('  .edit NAME CONTEXT -- Send to client, replace in context');
        out('');
        r.displayPrompt();
    });

    r.defineCommand('str', (name: string)=>{
        try {
            out(`${name}:`);
            const v = eval(name);
            out(`${JSON.stringify(v,null,4)}\n`);
        } catch(e) {
            out((e as Error).message);
        }
        r.displayPrompt();
    });

    r.defineCommand('x', ()=>{
        out(`\nCaptured values:`);
        for(const k in x) {
            out(`  x.${k} (${typeof x[k]})`)
            out(`${registeredMeta[k]}\n`);
        }
        r.displayPrompt();
    });



    r.context.fProxies = fProxies;
    r.defineCommand('fp', (cmd: string)=>{

        const argv = cmd.split(' ');

        if(!argv[0]) {
            out('.fp ls - list');
            out('.fp get NAME - get info');
            out('.fp break NAME - set breakpoint');
            out('.fp edit NAME - Send impl src to wsClient, on change, recompile and proxy.')
            out('See also fProxies');
            r.displayPrompt();
            return;
        }

        if(argv[0] === 'ls') {
            out('\nFunction proxies:')
            for(const p of Object.values(fProxies) ) {
                out(`  ${p.name}`);
                out(`${p.stack}\n`)
            }
            r.displayPrompt();
            return;
        }

        if(argv[0] === 'break') {
            const p = fProxies[argv[1]];
            if(p) {
                p.setBreak( async (bpStack:string, args: any[])=>{
                    out(`\ndebugRepl: Hit function proxy breakpoint ${p.name} via:`);
                    out(bpStack);
                    out('Local variables (this):');
                    out( JSON.stringify(p.runInCtx('Object.keys[this]')));
                    const ctxName = `brk_${p.name}`;
                    r.context[ctxName]={};
                    r.context[ctxName].args = args;
                    r.context[ctxName].eval = p.runInCtx;
                    r.context[ctxName].fp = p;
                    out(`Available in ${ctxName} are:`)
                    out(`    .fp     - This functionProxy`);
                    out(`    .args   - ${args.length} arguments`);
                    out(`    .eval   - Evaluate code in that scope, returns value`);
                    out(`    .resume - Call this to resume and call the active implementatio`);
                    r.displayPrompt();
                    return new Promise( resolve=> r.context[ctxName].resume = resolve ).then( ()=>{
                        out(`Resuming ${p.name} ...`);
                        delete r.context[ctxName];
                        r.displayPrompt();
                    });
                });
            } else {
                out(`${argv[1]} not found`);
            }
            r.displayPrompt();
            return;
        }

        if(argv[0] === 'get') {
            const p = fProxies[argv[1]];
            if(p) {
                const ctxName = `fp_${p.name}`;
                r.context[ctxName] = p;
                out(`Available in ${ctxName}`);
            } else {
                out(`${argv[1]} not found`);
            }
            r.displayPrompt();
            return;
        }

        if(argv[0] === 'edit') {
            if(!r.context.meta.ws) {
                out('edit only available with wsClient');
                r.displayPrompt();
                return;
            }
            const p = fProxies[argv[1]];
            if(p) {
                const toName = `${argv[1]}`
                r.context.meta.ws.send( JSON.stringify( { toName, from: p.impl.toString(), fp:true}) );
            } else {
                out(`${argv[1]} not found`);
            }
            setTimeout( ()=>r.displayPrompt(), 100 );
            return;
        }

    });


    r.defineCommand('sp', (cmd: string)=>{
        if(!cmd) {
            out('.sp (smart POI) usage:');
            out('  ls - List sPois');
            out('  clr       - Clear all breakpoints');
            out('  delete    - Delete all registered pois');
            out('  brk NAME  - Break next time sPoi is called (does not autoclear)');
            out('  sbrk NAME - Break ONLY next time sPoi is called')
            out(' See also the sp object');
            r.displayPrompt();
            return;
        }


        const argv = cmd.split(' ');

        const l = Object.values(sPois);
        if(argv[0] === 'ls') {
            out('\nRegistered sPois:');
            for(const p of l) {
                out(`  ${p.name}  ${p.breakCb ? 'brk':''}`);
                out(p.stack);
                out('');
            }
            r.displayPrompt();
            return;
        }

        if(argv[0] === 'clr') {
            out('All sPoi breakpoints removed.');
            for(const p of l) {
                p.breakCb=null;
            }
            r.displayPrompt();
            return;
        }

        if(argv[0] === 'delete') {
            out('All sPois deleted.');
            for(const k in sPois) {
                delete sPois[k];
            }
            r.displayPrompt();
            return;
        }

        if(argv[0] === 'brk' || argv[0] === 'sbrk') {
            const pp = sPois[argv[1]];
            if(!pp) {
                out(`sPoi ${argv[1]} not found`);
                r.displayPrompt();
                return;
            }

            const ctxName = `brk_sp_${pp.name}`;
            r.context[ctxName] = {
                sp: pp,
                clr: ()=> {
                    pp.breakCb=null;
                }
            };

            pp.breakCb = async () => {
                out(`\nHit ${pp.name} via:`);
                out(pp.stack);
                out(`  Registered ${ctxName}`);
                out(`  .sp       - Info on this sPoi`);
                if(argv[0] === 'brk') {
                    out(`  .clr()    - Clear breakpoint, ${ctxName}, and resume execution)`);
                }
                out(`  .resume() - Resume execution\n`);

                if(argv[0] === 'sbrk') {
                    pp.breakCb = null;
                    out('sbrk: breakpoint cleared')
                }

                r.displayPrompt();
                return new Promise( resolve => {
                    r.context[ctxName].resume=resolve;
                }).then( ()=> {
                    delete r.context[ctxName];
                });
            };
        }

    });
    r.context.sp = sPois;


    r.defineCommand('e', (src)=>{
        if(r.context.e) {
            r.context.e(src);
        }
        r.displayPrompt();
    });

    r.context.x = x;
    r.context.meta = {
        context: r.context,
        replInstance: r,
    };
    r.context.api = {
        cap,
        unCap,
        fProx,
        sPoi,
    };

    return {r, out};
}

function toggleSocket() {
    if(process.env.DBGRPL_NO_SOCKETS==='true') {
        console.log('debugRepl: webSocket disabled by DBGRPL_NO_SOCKETS');
        return;
    }

    if(!wss) {
        startSocket();
    } else {
        stopSocket();
    }
}

let ttyRpl: undefined | REPLServer;

export function debugReplTTY() {
    if(!ttyRpl) {
        if(process.stdout.isTTY) {
            console.log('debugRepl started:');
            ttyRpl = startRepl(process.stdin, process.stdout).r;
            ttyRpl.defineCommand('debugReplSocket', toggleSocket);
        } else {
            console.error('debugRepl: stdout is not a TTY, not starting REPL on stdio.');
            if(process.env.DBGRPL_NO_SOCKETS !== 'true') {
                console.log(`Send signal SIGUSR1 to process ${process.pid} to start debugRepl socket.`);
            }

        }
    }
}

if(process.env.DBGRPL_STDIO_ON_BOOT === 'true') {
    setTimeout( ()=>{
        debugReplTTY();
    }, 500);
}



if(process.env.DBGRPL_NO_SOCKETS !== 'true') {

    process.on('SIGUSR1', ()=>{
        toggleSocket();
    });

    if(process.env.DBGRPL_WS_ON_BOOT === 'true') {
        setTimeout( startSocket, 2000 );
    }
}



interface CapOpts {
    weak: boolean,
}


// API Locked.
export function cap(v: Record<string, any>, opts?: CapOpts) {
    const registeredNames = Object.keys(x);
    let source = (new Error().stack??'').split('\n').slice(2,3).join('\n');
    for(const k in v) {
        if(registeredNames.some( rn => rn=== k)) {
            console.log(`debugRepl: Overwriting registered name '${k}'`);
            console.log(`  previously registered via:`);
            console.log(registeredMeta[k]);
        }

        if(opts?.weak) {
            source += '\n  as WeakRef!'
            // @ts-ignore
            x[k] = new WeakRef( v[k] );
        } else {
            x[k] = v[k];
        }
        registeredMeta[k] = source;

    }
};

export function unCap(k: string) {
    delete x[k];
    delete registeredMeta[k];
}







// API Locked.
export function sPoi(name: string, getCtx: CtxInjector): Promise<void> | void {
    const thisPoi = sPois[name];
    if(thisPoi) {
        if(!thisPoi.breakCb) {
            return;
        }
        thisPoi.stack = (new Error().stack ?? '').split('\n').slice(2).join('\n');
        thisPoi.runInCtx = getCtx;
        return thisPoi.breakCb();
    } else {
        sPois[name] = {
            name,
            stack: (new Error().stack ?? '').split('\n').slice(2).join('\n'),
            runInCtx: getCtx,
            breakCb: null,
        };
    }
}


interface FproxDesc {
    name: string,
    setProxyImpl: any,
    setProxyImplSrc: any;
    stack: string;
    setVia: any;
    delproxyImpl: any,
    runInCtx: any,
    setBreak: any,
    delBreak: any,
    proxFun?: any,
    impl: any,
    break?: any,
    via?: string,
}

// API locked.
export function fProx<T extends (...args: any[]) => any>(
    name: string,
    runInCtx: CtxInjector,
    impl: T,
): T {

    const desc: FproxDesc = {
        name,
        runInCtx,
        impl,
        stack: (new Error().stack??'').split('\n').slice(2,3).join('\n'),
        setProxyImpl: (impl: T)=>{
            desc.proxFun = runInCtx( impl.toString() );
        },
        setProxyImplSrc: (src: string)=>{
            desc.proxFun = runInCtx( src );
        },
        setVia(str?: string) {
            if(str) {
                desc.via = str;
            } else {
                delete desc.via;
            }
        },
        delproxyImpl: ()=>{
            delete desc.proxFun;
        },
        setBreak: (cb: any) => {
            desc.break = cb;
        },
        delBreak: ()=>{
            delete desc.break;
        }
    };

    let nextNum=1;
    let tryName = name;
    while(fProxies[tryName]) {
        tryName = `${name}_${nextNum}`;
        nextNum++;
    }
    name = tryName;

    fProxies[tryName] = desc;

    async function proxy() {

        if(desc.break) {
            const args = Array.from(arguments);
            const bpStack = (new Error().stack ?? '').split('\n').slice(2).join('\n');
            await desc.break(bpStack, args);
            delete desc.break;
        }

        if(desc.via) {
            const stack = (new Error().stack ?? '').split('\n').slice(2).join('\n');
            if(desc.via && stack.indexOf(desc.via) != -1) {
                return desc.proxFun.apply(null, arguments);
            }
        } else if(desc.proxFun) {
            return desc.proxFun.apply(null, arguments);
        }
        return (impl as any).apply(null, arguments);
    }
    return proxy as T;
}