global.fflate=require(__dirname + '/../android/app/src/main/assets/www/vendor/fflate.js');
const {Parse,Sports}=require(__dirname + '/../android/app/src/main/assets/www/js/parse.js');
const Geo=require(__dirname + '/../android/app/src/main/assets/www/js/geo.js');
const gpx=Geo.gpx('Test','hike',[{lat:47,lon:11,ele:500,t:1e12},{lat:47.001,lon:11,ele:520,t:1e12+60000},{lat:47.002,lon:11.001,ele:540,t:1e12+120000}]);
(async()=>{
 const r=await Parse.any('a.gpx',new TextEncoder().encode(gpx));
 const A=require('assert');A.strictEqual(r[0].name,'Test');A.strictEqual(r[0].sport,'hike');A.strictEqual(r[0].pts.length,3);A.ok(Geo.stats(r[0].pts).dist>200);
 const z=fflate.zipSync({'activities/1.gpx.gz':fflate.gzipSync(new TextEncoder().encode(gpx))});
 const r2=await Parse.any('x.zip',z); A.strictEqual(r2.length,1);
 for (const [s,e] of [['Run','run'],['MountainBikeRide','mtb'],['e_touringbicycle','ebike'],['hike','hike'],['touringbicycle','bike'],['racebike','racebike'],['Walk','walk'],['EBikeRide','ebike'],['Hiking','hike'],['jogging','run']]) A.strictEqual(Sports.norm(s),e,s);
 // FIT: build minimal file
 const rec=[];const def=[0x40,0,0,20,0,4,253,4,0x86,0,4,0x85,1,4,0x85,2,2,0x84];
 const b=[];b.push(...def);
 function rcd(ts,la,lo,alt){const d=new DataView(new ArrayBuffer(1+4+4+4+2));d.setUint8(0,0);d.setUint32(1,ts,true);d.setInt32(5,Math.round(la*2147483648/180),true);d.setInt32(9,Math.round(lo*2147483648/180),true);d.setUint16(13,(alt+500)*5,true);return [...new Uint8Array(d.buffer)];}
 b.push(...rcd(1000000000,47.5,11.5,800),...rcd(1000000010,47.501,11.501,805));
 const hdr=[14,0x10,0,0,b.length&255,b.length>>8,0,0,0x2e,0x46,0x49,0x54,0,0];
 const fit=new Uint8Array([...hdr,...b,0,0]);
 const r3=Parse.fit(fit);A.strictEqual(r3[0].pts.length,2);A.strictEqual(r3[0].pts[0].ele,800);A.ok(Math.abs(r3[0].pts[0].lat-47.5)<1e-6);console.log('OK');
})();
