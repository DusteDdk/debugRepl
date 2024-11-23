#!/usr/bin/env node
// @ts-nocheck

const fs = require('fs');
const Websocket = require('ws').WebSocket;
const path = require('path');

const arg = process.argv[2];

let url;

if(arg) {
    try {
        url = new URL(arg);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
} else {

    console.error('Usage:');
    console.error(`    ${process.argv[1]} URL`);
    process.exit(1);
}


const ws = new Websocket(url);



ws.on('open', ()=>{
    console.log('Connection established.');
    process.stdin.pause();
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('hex');
    process.stdin.resume();


    process.stdin.on('data', (data)=>{

        if(data === '03') {
            console.log('User exit.');
            process.exit();
        }

        ws.send(JSON.stringify({b:data}));
    });
    ws.send(JSON.stringify({size: { rows: process.stdout.rows, columns: process.stdout.columns}}));
    process.stdout.on('resize', ()=>{
        ws.send(JSON.stringify({size: { rows: process.stdout.rows, columns: process.stdout.columns}}));
    });
});

process.on('SIGINT', () => {
    console.log("Caught interrupt signal");
    process.exit();
});

ws.on('close', ()=>{
    console.log('Connection closed.');
    process.exit();
});

ws.on('error', (e)=>{
    console.error('Connection error:');
    console.error(e);
    process.exit(1);
});

ws.on('message', (data)=>{
    try {
        const msg = JSON.parse(data.toString());

        if(msg.ping) {
            return ws.send(JSON.stringify({pong:true}));
        }
        if(msg.b) {
            var outbuf = Buffer.from(msg.b, 'hex');
            process.stdout.write(outbuf);
        }

        if(msg.c) {
            console.log.apply(console, msg.c);
        }

        if(msg.from) {
            const fileName = path.resolve(`DBGRPL_${msg.toName}.js`);
            fs.unwatchFile(fileName);
            fs.writeFileSync(fileName, msg.from, {encoding: 'utf8'});
            console.log(`debugReplClient: Saved ${fileName} (${msg.from.length} b)`);
            fs.watchFile(fileName, { }, (stat)=>{
                const txt = fs.readFileSync(fileName, {encoding: 'utf8'});
                ws.send( JSON.stringify( {fileName, toName: msg.toName, to: txt} ) );
            });
        }
    } catch(e) {
        console.log('MSG error:',e);
    }
});