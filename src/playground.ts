import { addPoi, cap } from "./debugRepl";

class StrangeClass {
    constructor(private a: number, private b: number) {}

    strangeAdditions = addPoi('strangeAdditions', 'justCalled,addedFirst,beforeReturn', ({justCalled,  addedFirst, beforeReturn}) =>
        async (c: number) => {
            let something='else';
            await justCalled( s=>eval(s) );
            this.a += this.b;
            await addedFirst( s=>eval(s) );
            this.a += c;
            const returnValue = this.a + this.b + c;
            await beforeReturn( s=>eval(s) );
            return returnValue;
    });
}

const sc = new StrangeClass(1,2);


setInterval( async()=>{
    const importantResult = await sc.strangeAdditions(3);
    console.log(importantResult);
}, 10000);


cap( { ectx: (s:string)=>eval(s) });
