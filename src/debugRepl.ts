
import vm, { Context, runInContext } from 'node:vm';
import { randomUUID } from "crypto";
import { networkInterfaces } from 'os';
import { ReadableOptions,Readable, Writable } from "stream";
import WebSocket, { WebSocketServer } from "ws";
import repl from "node:repl";

const x: Record<string, any> = {};
const registeredMeta: Record<string, string> = {};


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
const fProxies: {[key:string]: FproxDesc} = {

}

// Register a point of interest (dynamic breakpoint)
let poiNum=1;
let proxId = 0;

type CtxInjector = (src: string)=>ReturnType<typeof eval>;
type Poi = (gsc: CtxInjector)=>void | Promise<void>;
type PoiSub = null | ((scope: any )=> boolean);
interface PoiDesc {
    id: number;
    desc: string;
    sub: PoiSub;
    subVia: undefined | string;
    resume: any;
}

interface PoiEntry {
    proxId: number;
    name: string;
    setProxy: Function;
    unsetProxy: Function;
    proxy: Function;
    isProxied: boolean;
    proxVia: string | undefined;
    orig: Function;
    pois: PoiDesc[];
    instance?: any;
    tracking: boolean;
    stacks: {[key: string]: number},
}


let poiList: PoiEntry[] = [];
let clients: DebugClient[] = [];
let logClients: DebugClient[] = [];
let token: string | null = null;

let oldLog: any;
let wss: WebSocketServer;

function stopSocket() {

    for(const c of clients) {
        c.ws.close();
    }

    clients=[];

    console.log = oldLog;

    setTimeout( ()=> {
        wss.close();
        token = null;
        console.log('Stopped debugRepl socket.');
    }, 10);
}

function startSocket() {
    token = randomUUID();
    oldLog = console.log.bind(console);

    console.log = (...args)=>{
        oldLog.apply(console, args);
        args.unshift('>');
        for(const c of logClients) {
            c.ws.send(JSON.stringify({c:args}));
        }
    };

    const port = 31374;
    console.log(`debugRepl started:`);
    const nets = (networkInterfaces() ?? {} )as {[key:string]: any};
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' || net.family === 'IPv6') {
                console.log(`node ${__dirname}/../bin/wsClient.js\tws://${net.address}:${port}/${token}`);
            }
        }
    }
    console.log();

    let clientNum=0;
    wss = new WebSocket.Server({ port });
    wss.on('connection', (ws: WebSocket, req: Request) => {

        const out = (...args: any)=>{
            ws.send(JSON.stringify({b:Buffer.from( args.join(' ')+'\n', 'utf8').toString('hex')}));
        };



        const pingInterval = setInterval( ()=>{
            if(ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ping:true}));
            }
        }, 1000);
        clientNum++;
        if( req.url !== `/${token}`) {
            out(`Error: Invalid token.`);
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



        out(`Welcome to debugRepl session ${token}`);

        const input = new CInStream(undefined);
        const output = new COutStream(undefined, (data, encoding)=>{
            ws.send(JSON.stringify({b: data.toString('hex')}));
        });

        const r = startRepl(input, output, out);

        r.defineCommand('toggleConsoleLog', ()=>{
            if( logClients.some( c => c.clientNum === client.clientNum ) ) {
                logClients = logClients.filter( c=> c.clientNum !== client.clientNum);
                out('console.log messages: disabled');
            } else {
                logClients.push(client);
                out('console.log messages: enabled');
            }
        });


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

            } else {
                out('Usage: .from SRCNAME to DESTNAME - sends object to client file and declares DESTNAME in local context on file change (websocket only)');
                return;
            }
        });



        ws.on('message', (buf)=>{

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
                        //const fromResult = eval(str);
                        const script = new vm.Script(str, {filename});
                        const inResult = script.runInThisContext();
                        out(`debugRepl: ${toName} = ${typeof inResult} from ${filename} (${str.length} b) `);
                        r.context[toName] = inResult;
                    } catch(e) {
                        out(`debugRepl: Evaluation failed: ${(e as Error).message}`);
                    }
                }

            } catch(e) {
                console.error(`debugRepl: Error parsing message from ${clientNum}`);
                console.error(e);
            }
        });
    });

}


function startRepl(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, out: (...args: any[])=>any) {


    const r = repl.start({ useGlobal: true, prompt: 'x: ', input, output });
    r.setupHistory('/tmp/node.repl.hist', (err: any)=>{
        if(err) {
            out('Repl history error');
        }
    });

    r.defineCommand('help', ()=>{
        out('\nDSTs debugRepl help:');
        out('  .poi      -- Show how to use points of interest.');
        out('  .x        -- Show info about values registered with "cap()".');
        out('  .str VAR  -- Pretty JSON.stringify the variable and show it.');
        out('  .from SRCNAME DSTNAME -- Send the string representation of SRC name to file DSTNAME on socket client.');
        out('  .fp       -- Faster/better/smarter proxy function than poi, probably, who knows, a different approach anyway.')
        out('');
    });

    r.defineCommand('str', (name: string)=>{
        try {
            out(`${name}:`);
            const v = eval(name);
            out(`${JSON.stringify(v,null,4)}\n`);
        } catch(e) {
            out((e as Error).message);
        }
    });

    r.defineCommand('x', ()=>{
        out(`x:`);
        for(const k in x) {
            out(`  x.${k} (${typeof x[k]}) registered:`)
            out(`${registeredMeta[k]}\n`);
        }
    });

    r.defineCommand('track', (cmd: string)=>{
        if(!cmd) {
            out('See .poi');
            return;
        }

        if(cmd==='ls') {
            out('Tracked points of interest functions:');
            for(const pe of poiList) {
                out(`  ${pe.proxId}: ${pe.name} ${pe.tracking ? '(tracking)': '(not tracking)'}`);
                const k = Object.keys(pe.stacks);
                if(!k.length) {
                    out('  Calls: 0');
                }
                for(const s in pe.stacks) {
                    out(`  Calls: ${pe.stacks[s]}`);
                    out(s);
                    out('');
                }
            }
            return;
        }
        const fpoiNum = parseInt(cmd);

        const fpoi = poiList.find( fp=>fp.proxId === fpoiNum);
        if(!fpoi) {
            out(`No fpoi ${fpoiNum}`);
            return;
        }
        out(`Tracking ${fpoiNum}`);
        fpoi.tracking=true;



    });

    r.context.fProxies = fProxies;
    r.defineCommand('fp', (cmd: string)=>{

        const argv = cmd.split(' ');

        if(!argv[0]) {
            out('.fp ls - list');
            out('.fp get NAME - get info');
            out('.fp break NAME - set breakpoint');
            out('See also fProxies');
            return;
        }

        if(argv[0] === 'ls') {
            out('Registered functions:')
            for(const p of Object.values(fProxies) ) {
                out(`  ${p.name}`)
            }
            return;
        }

        if(argv[0] === 'break') {
            const p = fProxies[argv[1]];
            if(p) {
                p.setBreak( async (bpStack:string, args: any[])=>{
                    out(`Hit function proxy breakpoint ${p.name} via:`);
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

                    return new Promise( resolve=> r.context[ctxName].resume = resolve ).then( ()=>{
                        out(`Resuming ${p.name} ...`);
                        delete r.context[ctxName];
                    });
                });
            } else {
                out(`${argv[1]} not found`);

            }
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
        }




    });

    r.defineCommand('prox', (cmd: string)=>{
        if(!cmd) {
            out('See .poi');
            return;
        }

        if(cmd === 'ls') {
            out(`Point of interest functions:`);
            for(const pe of poiList) {
                out(`  ${pe.proxId}: ${pe.name} ${pe.tracking ? '(tracking)': '(not tracking)'}`);
            }
            out(``);
            return;
        }

        const [fpoiStr, funName, via, stackStr] = cmd.split(' ').map( s=>s.replace(/ /g, ''));


        const fpoiNum = parseInt(fpoiStr);


        const fpoi = poiList.find( fp=>fp.proxId === fpoiNum);
        if(!fpoi) {
            out(`No fpoi ${fpoiNum}`);
            return;
        }

        if(funName === 'ls') {
            out(`Source for fpoi ${poiNum}`);
            out(fpoi.proxy.toString());
            return;
        }

        if(funName === 'via') {
            out('via is a reserved name for .prox it may not be used in functions.\nDid you forget the function name?');
            return;
        }

        if(funName === 'to' && via) {
            out(`Saving active implementation of ${fpoiNum} to local variable ${via}`);
            r.context[via] = fpoi.proxy;
            return;
        }

        if(!funName) {
            out(`Unproxied ${fpoi.proxId} ${fpoi.name}`);
            fpoi.unsetProxy();
        } else {
            const funImpl = eval(funName);
            if(!funImpl) {
                out(`No function with name ${funName}`);
                return;
            }
            out(`Proxied ${fpoi.proxId} ${fpoi.name} with ${funName}`);
            if(via==='via') {
                out(`    via stacks with ${stackStr} (started tracking stacks)`);
                out('    calls via unmatched stacks goes to original impl.');
                fpoi.tracking=true;
                fpoi.proxVia=stackStr;
            }
            fpoi.setProxy(funImpl);
        }
    });

    r.defineCommand('e', (src)=>{
        if(r.context.e) {
            r.context.e(src);
        }
    });

    r.defineCommand('poi', (cmd: string)=>{
        if(!cmd) {
            out('\nPoint of interest commands:');
            out('  .poi ls - list registered POIs and their possible breaks.');
            out('  .poi BNUM [via STR]')
            out('    - when not subscribed: Subscribes to poi break BNUM,')
            out('      when "via STR" provided, only where stacktrace contains STR.');
            out('    - when subscribed: Unsubscribes.');
            out('    - when was called: Continues execution.');
            out('\nStack trace discovery:');
            out('  .track ls  - Show recorded stack traces for POIs.');
            out('  .track PNUM - Toggle recording of stack traces for POI.');
            out('\nOverwriting POIs:');
            out('  .prox ls  - list proxied implementations.');
            out('  .prox PNUM ls - List source for currently active implementation.');
            out('  .prox PNUM [NAME [via STR]]');
            out('    - When no proxy is in place: Replaces original implementation with function of NAME for POI');
            out('      when "via STR" provided, call function of NAME only when stacktrace contains STR,');
            out('        note: "via STR" enables tracking.');
            out('    - When any proxy is in place: Restores original implementation.');
            out('  .prox PNUM to DSTNAME - save reference to implementation in DSTNAME');
            return;
        }

        if(cmd === 'ls') {
            out('Points of interest:');
            for(const pe of poiList) {
                out(`    ${pe.proxId}: ${pe.name}  (function)`);
                if(pe.isProxied) {
                    if(pe.proxVia) {
                        out(`        -- Proxied when called via stack with ${pe.proxVia}`);
                    } else {
                        out(`        -- Proxied`);
                    }
                } else {
                    for(const p of pe.pois) {
                        out(`      ${p.id} - ${p.desc} - ${ p.sub ? 'subbed' +((p.subVia)?` (via ${p.subVia})`:'') : 'unsubbed'}`);
                    }
                }

            }
            out('.poi  NUM to break in next time it is executed');
            return;
        } else  {
            const [pidStr, arga, argb] = cmd.split(' ').map( s=>s.replace(/ /g, ''));
            const pid = parseInt(pidStr);
            //const poi = pois.find( p => p.id === pid);
            let poi: PoiDesc | undefined;
            for(const pe of poiList) {
                poi = pe.pois.find( p=>p.id === pid);
                if(poi) {
                    break;
                }
            }

            if(poi) {
                if(poi.sub) {
                    // Unsubscribe
                    out(`Unsubscribed from ${pid}`);
                    poi.sub=null;
                    return;
                }

                if(poi.resume) {
                    // resume
                    out(`Resuming ${poi.desc} ${pid}`);
                    const resume = poi.resume;
                    poi.resume=null;
                    delete r.context.e;
                    setImmediate( resume );
                    return;
                }

                // Subscribe
                out(`Subscribed to ${pid}`);
                delete poi.subVia;
                if(arga === 'via') {
                    if(argb) {
                        out(`    via stacks with ${argb}`);
                        poi.subVia = argb;
                    } else {
                        out('via what? ignored');
                    }
                }
                poi.sub = (ecb)=>{
                    const stack = (new Error().stack ?? '').split('\n').slice(3).join('\n');
                    if(poi.subVia && stack.indexOf(poi.subVia)=== -1) {
                        return false;
                    }
                    out(`\nEntered POI ${poi.id} - ${poi.desc}, via:`);
                    out( stack );

                    out('Execute in POI scope with e(src) and .e src');

                    r.context.e = ecb;


                    out(`\nCode might be waiting: remember to .poi ${poi.id} to continue.\n`);
                    return true;
                };

            } else {
                out(`POI ${pid} not found.`);
            }
        }
    });


    r.context.x = x;
    r.context.meta = {
        context: r.context,
        replInstance: r,
    };
    r.context.api = {
        cap,
        unCap,
        addPoi,
        delPoi
    };

    return r;
}


if(process.stdout.isTTY && process.env.DBGRPL_NO_STDIO !== 'true') {
    setTimeout( ()=>{
        const r = startRepl(process.stdin, process.stdout, console.log.bind(console));
        r.defineCommand('debugReplSocket', ()=>{
            toggleSocket();
        });
    }, 250);
} else {
    console.log(`No TTY, send SIGUSR1 to ${process.pid} to start debugRepl socket`);
}

function toggleSocket() {
    if(!token) {
        startSocket();
    } else {
        stopSocket();
    }
}

if(process.env.DBRPL_SOCKET_ON_BOOT === 'true') {
    toggleSocket();
}

if(process.env.DBGRPL_NO_SOCKETS !== 'true') {
    process.on('SIGUSR1', ()=>{
        toggleSocket();
    });
}


/*
    Importing this file starts the REPL
    Calling cap registers an object or function for use in
    interactive experiements or debugging sessions.

    All registered objects are added to the x object which is available in the REPL context.
    x - The object containing all registered objects and functions

    // Example:
    const myObject = ...

    cap({objectOne: myObject, ...});
    //x.objectOne is now available for read/write from the debug repl.


*/

export function cap(v: Record<string, any>) {
    const registeredNames = Object.keys(x);
    const source = (new Error().stack??'').split('\n').slice(2).join('\n');
    for(const k in v) {
        if(registeredNames.some( rn => rn=== k)) {
            console.log(`debugRepl: Overwriting registered name '${k}'`);
            console.log(`  previously registered via:`);
            console.log(registeredMeta[k]);
        }

        registeredMeta[k] = source;
        x[k] = v[k];
    }
};

export function unCap(k: string) {
    delete x[k];
    delete registeredMeta[k];
}





function poi(desc: string): {desc: PoiDesc, breakFunc: Poi} {
    const id = poiNum++;
    const self: PoiDesc = {
        id,
        desc,
        sub: null,
        subVia:undefined,
        resume: null,
    };

    return {
        breakFunc: (scopeCb: CtxInjector) =>{
            if(self.sub && self.sub(scopeCb) ) {
                self.sub = null;
                return new Promise( resolve=>{
                    self.resume = resolve;
                });

            }
            return;
        },
        desc: self
    };

}



export function delPoi(pfun: Function) {
    const proxId = (pfun as any)._dbgRplProxId;
    if(proxId) {
        console.log('Deleted poi'+proxId);
        const peIndex = poiList.findIndex(e=>e.proxId === proxId);
        if(peIndex !== -1) {
            const pe = poiList[peIndex];
            // Restore original impl.
            pe.unsetProxy();
            pe.stacks={};
            for(const p of pe.pois) {
                p.sub=null;
                p.resume=null;
                delete p.subVia;
                p.desc='';
            }
            pe.pois=[];
            poiList.splice(peIndex, 1); // Remove the object in place

        }
    }
}

/**
 * 
 * @param fname Function name or other human-readable descrption
 * @param breaks Comma separated list of desired breakpoint functions
 * @param body Function body to instrument
 * @param instance optional - class instance
 * @returns 
 */

 type Trim<S extends string> = S extends ` ${infer T}` | `${infer T} `
 ? Trim<T>
 : S;

type Split<S extends string, Delimiter extends string = ','> =
 S extends `${infer Head}${Delimiter}${infer Tail}`
   ? [Trim<Head>, ...Split<Tail, Delimiter>]
   : S extends ''
     ? []
     : [Trim<S>];

// Create a mapped type to enforce the structure of the callback argument
type BreakMap<BreakName extends string> = {
   [K in Split<BreakName>[number]]: Poi; // All keys must exist and have a value
};



type FpoiWrapper<
    T extends string,
    ImplType,
    > = (poiMap: BreakMap<T>)=>ImplType;


export function addPoi
    <
        BreakList extends string,
        ImplType extends (...args: any[])=>any
    > (fname: string, breaks:BreakList, body: FpoiWrapper<BreakList, ImplType>): ReturnType<typeof body> {

    proxId++;

    const pois: PoiDesc[] = [];

    const names = breaks.replace(/ /g,'').split(',') as Split<BreakList>;
    const pmap = {} as BreakMap<BreakList>;
    for(const n of names) {
        const p = poi(n);
        pmap[(n as Split<BreakList>[number])] = p.breakFunc;
        pois.push(p.desc);

    }

    const orig = body(pmap);

    const desc: PoiEntry = {
        proxId,
        name: fname,
        setProxy: (fun: Function)=>{
            desc.isProxied=true;
            desc.proxy = fun;
        },
        unsetProxy: ()=>{
            desc.isProxied=false;
            desc.proxy = orig;
            delete desc.proxVia;
        },
        proxy: orig,
        isProxied: false,
        proxVia: undefined,
        orig,
        pois,
        tracking: false,
        stacks: {}
    };

    poiList.push(desc);

    const poiFun = (function () {
        if(desc.tracking) {
            const stack = (new Error().stack ?? '').split('\n').slice(2).join('\n');
            if(!desc.stacks[stack]) {
                desc.stacks[stack]=0;
            }
            desc.stacks[stack]++;

            if(desc.proxVia && stack.indexOf(desc.proxVia) != -1) {
                return desc.proxy.apply(null, arguments);
            } else {
                return desc.orig.apply(null, arguments);
            }
        }

        return desc.proxy.apply(null, arguments);
    }) as ReturnType<typeof body>;

    (poiFun as any)._dbgRplProxId = desc.proxId;

    return poiFun;

}


interface FproxDesc {
    name: string,
    setProxyImpl: any,
    delproxyImpl: any,
    runInCtx: any,
    setBreak: any,
    delBreak: any,
    proxFun?: any,
    break?: any,
    via?: string,
}

export function fProx<T extends (...args: any[]) => any>(
    name: string,
    impl: T,
    runInCtx: CtxInjector
): T {

    const desc: FproxDesc = {
        name,
        runInCtx,
        setProxyImpl: (impl: T)=>{
            desc.proxFun = runInCtx( impl.toString() );
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