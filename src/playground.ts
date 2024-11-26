import { addPoi, cap, fProx, sPoi } from "./debugRepl";

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

    strangeAdditions2 = fProx('strangeAdditions2', s=>eval(s), async (c: number) => {
        let something='else';
        this.a -= this.b;
        this.a -= c;
        const returnValue = this.a + this.b + c;
        await sPoi('returning', s=>eval(s));
        return returnValue;
    });

    run = fProx('run', s=>eval(s), async (n:number) =>{
        await this.differentApproach(n);
        await this.strangeAdditions2(n);
    });


    differentApproach = fProx( 'differentApproach', s=>eval(s),
        (c: number ) => (c+this.a)*this.b,
    );
}

const sc = new StrangeClass(1,2);


const interval = setInterval( async()=>{
    const importantResult = await sc.run(3);
    console.log(importantResult);
}, 10000);


cap( { ectx: (s:string)=>eval(s) });
