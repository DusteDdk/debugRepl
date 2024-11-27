import { cap, fProx, sPoi } from "./debugRepl";

class StrangeClass {
    constructor(private a: number, private b: number) {}

    async strangeAdditions(c: number) {
            this.a += this.b;
            this.a += c;
            const returnValue = this.a + this.b + c;
            return returnValue;
    }

    async strangeAdditions2 (c: number) {
        let something='else';
        this.a -= this.b;
        this.a -= c;
        const returnValue = this.a + this.b + c;
        await sPoi('returning', s=>eval(s));
        return returnValue;
    }

    run = fProx('run', s=>eval(s), async (n:number) =>{
        await this.differentApproach(n);
        await this.strangeAdditions2(n);
    });


    differentApproach = fProx( 'differentApproach', s=>eval(s),
        (c: number ) => (c+this.a)*this.b,
    );
}

const someObject = {
    a: 1,
    b: 2,
}

const sc = new StrangeClass(1,2);

const interval = setInterval( async()=>{
    const importantResult = await sc.run(3);
    console.log(importantResult);
}, 10000);

// Capture trace and provide context
sPoi('main', s=>eval(s));

// Another way to expose context and capture variables, the key names has no special meaning,
// Chose names that makes sense in the greater context, as they must be unique.
cap( {
        runInMain: (s:string)=>eval(s),
        strangeInstance: sc,
        strangeInstanceAdd: sc.strangeAdditions
});


/* Things that are surprisingly easy:
    Change the _onTimeout implementation inside the timeout while it's running
    Clearing the interval
    Modifying someObject
    Breaking before strangeAdditions2 returns its value
    Fixing the run function so it returns a value, while the program runs
*/

