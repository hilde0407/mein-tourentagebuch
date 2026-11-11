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
 // Zepp-Token aus der Zwischenablage
 const T='a1B2c3D4e5F6g7H8i9J0kLmN',Z=Parse.zeppToken;
 A.strictEqual(Z(T),T);A.strictEqual(Z('  "'+T+'"\n'),T);A.strictEqual(Z('apptoken='+T+'; Path=/'),T);A.strictEqual(Z('Bearer '+T),T);
 A.strictEqual(Z('abc+def%3D%3D'+T),'abc+def=='+T);A.strictEqual(Z('zu kurz'),null);A.strictEqual(Z(''),null);A.strictEqual(Z(null),null);A.strictEqual(Z('hallo welt das ist kein token!'),null);
 // FIT: build minimal file
 const rec=[];const def=[0x40,0,0,20,0,4,253,4,0x86,0,4,0x85,1,4,0x85,2,2,0x84];
 const b=[];b.push(...def);
 function rcd(ts,la,lo,alt){const d=new DataView(new ArrayBuffer(1+4+4+4+2));d.setUint8(0,0);d.setUint32(1,ts,true);d.setInt32(5,Math.round(la*2147483648/180),true);d.setInt32(9,Math.round(lo*2147483648/180),true);d.setUint16(13,(alt+500)*5,true);return [...new Uint8Array(d.buffer)];}
 b.push(...rcd(1000000000,47.5,11.5,800),...rcd(1000000010,47.501,11.501,805));
 const hdr=[14,0x10,0,0,b.length&255,b.length>>8,0,0,0x2e,0x46,0x49,0x54,0,0];
 const fit=new Uint8Array([...hdr,...b,0,0]);
 const r3=Parse.fit(fit);A.strictEqual(r3[0].pts.length,2);A.strictEqual(r3[0].pts[0].ele,800);A.ok(Math.abs(r3[0].pts[0].lat-47.5)<1e-6);

 // Puls aus GPX (Garmin-Erweiterung), TCX und FIT – und wieder hinaus ins GPX
 const ghr='<gpx><trk><trkseg><trkpt lat="47" lon="11"><ele>500</ele><time>2026-01-01T10:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>131</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>'
   +'<trkpt lat="47.001" lon="11"><ele>510</ele><time>2026-01-01T10:00:10Z</time><extensions><ns3:hr>300</ns3:hr></extensions></trkpt></trkseg></trk></gpx>';
 const h1=Parse.gpx(ghr)[0].pts; A.strictEqual(h1[0].hr,131); A.strictEqual(h1[1].hr,null);   // 300 bpm ist unglaubwürdig
 const tcx='<TrainingCenterDatabase><Activity Sport="Biking"><Trackpoint><Time>2026-01-01T10:00:00Z</Time><Position><LatitudeDegrees>47</LatitudeDegrees><LongitudeDegrees>11</LongitudeDegrees></Position><HeartRateBpm xsi:type="t"><Value>118</Value></HeartRateBpm></Trackpoint></Activity></TrainingCenterDatabase>';
 A.strictEqual(Parse.tcx(tcx)[0].pts[0].hr,118);
 A.ok(Geo.gpx('P','hike',h1).includes('<gpxtpx:hr>131</gpxtpx:hr>'));
 A.ok(Geo.gpx('P','hike',h1).includes('xmlns:gpxtpx='));

 // FIT mit Pulsfeld (Nummer 3, ein Byte)
 const def2=[0x40,0,0,20,0,5,253,4,0x86,0,4,0x85,1,4,0x85,2,2,0x84,3,1,2];
 function rcd2(ts,la,lo,alt,hr){const d=new DataView(new ArrayBuffer(1+4+4+4+2+1));d.setUint8(0,0);d.setUint32(1,ts,true);d.setInt32(5,Math.round(la*2147483648/180),true);d.setInt32(9,Math.round(lo*2147483648/180),true);d.setUint16(13,(alt+500)*5,true);d.setUint8(15,hr);return [...new Uint8Array(d.buffer)];}
 const b2=[...def2,...rcd2(1000000000,47.5,11.5,800,122),...rcd2(1000000010,47.501,11.501,805,255)];
 const fit2=new Uint8Array([14,0x10,0,0,b2.length&255,b2.length>>8,0,0,0x2e,0x46,0x49,0x54,0,0,...b2,0,0]);
 const r4=Parse.fit(fit2); A.strictEqual(r4[0].pts[0].hr,122); A.strictEqual(r4[0].pts[1].hr,null);   // 255 = kein Messwert

 // Zepp liefert Puls als Folge von Änderungen – Spalte 1 muss aufsummiert werden
 const col=(s,idx,defOne)=>(s||'').split(';').filter(Boolean).map(v=>{if(idx!=null)v=v.split(',')[idx];return parseInt(v||(defOne?1:0),10)||0});
 const cum=a=>{let s=0;return a.map(v=>s+=v)};
 A.deepStrictEqual(cum(col('1,108;0,1;,0;,-2',1)),[108,109,109,107]);
 console.log('OK');
})();
