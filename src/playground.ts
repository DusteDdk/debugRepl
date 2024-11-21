import { addPoi, cap } from "./debugRepl";

class StrangeClass {
    constructor(private a: number, private b: number) {}

    strangeAdditions = addPoi('strangeAdditions', 'justCalled,addedFirst,beforeReturn', ({justCalled,  addedFirst, beforeReturn}) =>
        async (c: number) => {
            await justCalled( ()=>({instance: this, c}));
            this.a += this.b;
            await addedFirst( ()=>({instance: this}));
            this.a += c;
            const returnValue = this.a + this.b + c;
            await beforeReturn( ()=>({instance: this, returnValue}));
            return returnValue;
    });
}

const sc = new StrangeClass(1,2);


setInterval( async()=>{
    const importantResult = await sc.strangeAdditions(3);
    console.log(importantResult);
}, 10000);

cap({sc});


