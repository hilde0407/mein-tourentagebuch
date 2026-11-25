global.fflate=require(__dirname + '/../android/app/src/main/assets/www/vendor/fflate.js');
const {Parse,Sports}=require(__dirname + '/../android/app/src/main/assets/www/js/parse.js');
const Geo=require(__dirname + '/../android/app/src/main/assets/www/js/geo.js');
const gpx=Geo.gpx('Test','hike',[{lat:47,lon:11,ele:500,t:1e12},{lat:47.001,lon:11,ele:520,t:1e12+60000},{lat:47.002,lon:11.001,ele:540,t:1e12+120000}]);
(async()=>{
 const r=await Parse.any('a.gpx',new TextEncoder().encode(gpx));
 const A=require('assert');A.strictEqual(r[0].name,'Test');A.strictEqual(r[0].sport,'hike');A.strictEqual(r[0].pts.length,3);A.ok(Geo.stats(r[0].pts).dist>200);
 const z=fflate.zipSync({'activities/1.gpx.gz':fflate.gzipSync(new TextEncoder().encode(gpx))});
 const r2=await Parse.any('x.zip',z); A.strictEqual(r2.length,1);
 for (const [s,e] of [['Run','run'],['MountainBikeRide','mtb'],['e_touringbicycle','ebike'],['hike','hike'],['touringbicycle','bike'],['racebike','racebike'],['Walk','walk'],['EBikeRide','ebike'],['Hiking','hike'],['jogging','run'],
   ['nordicwalking','nordicwalking'],['Nordic Walking','nordicwalking'],['nordic','nordic'],['skitour','skitour'],['skialpin','skialpin'],['snowshoe','snowshoe'],['e_mtb','emtb'],['mtb','mtb'],['mountaineering','mountaineering'],['other','other'],['kitesurfen','other'],['Billard','other'],['mtb_easy','gravel'],['skaten','inline'],['climbing','climbing'],['trailrun','trailrun'],['bikepacking','bikepacking'],['paraglide','paraglide'],['rafting','rafting'],['dragonboat','dragonboat'],['boat','boat']]) A.strictEqual(Sports.norm(s),e,s);      // letzte Zeile: Sportarten aus „Meine Touren“ (2.1.0)
 // 2.2.0: Wintersportarten getrennt; 2.19.0: Schneeschuh wieder eigene Sportart (mit Schlagwort)
 for (const [s,e] of [['Skifahren','skialpin'],['ski','skialpin'],['Snow','skialpin'],['AlpineSki','skialpin'],['BackcountrySki','skitour'],['NordicSki','nordic'],['Snowshoe','snowshoe'],['Snowboard','snowboard'],['downhill_skiing','skialpin'],
   ['resort_skiing','skialpin'],['backcountry_skiing','skitour'],['cross_country_skiing','nordic'],['Skitouren','skitour'],['ski_mountaineering','skitour'],['Langlauf','nordic'],['Schneeschuhwandern','snowshoe'],
   ['snow_shoe','snowshoe'],['skate skiing','nordic'],['Nordic Walking','nordicwalking'],['nordicwalking','nordicwalking'],['Mountaineering','mountaineering'],['Kitesurf','other'],['Yoga','other']]) A.strictEqual(Sports.norm(s),e,s);
 // 2.19.0: Aktivitäten-Katalog (endgültige Auswahl, 29) – Zuordnungen aus Strava, Garmin, Komoot, Meine Touren; was die App nicht führt, bekommt den Rückfall der Auswahl
 for (const [s,e] of [['TrailRun','trailrun'],['GravelRide','gravel'],['EMountainBikeRide','emtb'],['InlineSkate','inline'],['Kayaking','kayak'],['Canoeing','kayak'],['Rowing','rowing'],
   ['RockClimbing','climbing'],['Klettersteig','climbing'],['Reiten','horse'],['Dragonboat','dragonboat'],['Skateboard','skateboard'],['Ride','bike'],['e_touringbicycle','ebike'],
   ['Bikepacking','bikepacking'],['bike_packing','bikepacking'],['Paragliding','paraglide'],['Gleitschirmfliegen','paraglide'],['Rafting','rafting'],['Whitewater rafting','rafting'],['Boating','boat'],['Motorboot','boat'],['Bergtour','mountaineering'],
   // Rückfall (aktivitaeten-final.md): Gassigehen→Spazieren, Orientierungslauf→Laufen, Pilgern→Wandern, Radpendeln→Radtour, Cyclocross→Rennrad, BMX→Sonstiges, Splitboard→Skitour,
   // Schneemobil/Rodeln/Eislaufen→Sonstiges, SUP→Kajak, Segeln/Freiwasser/Schnorcheln/Tauchen/Surfen/Wasserski→Sonstiges, alles andere→Sonstiges
   ['dog_walking','walk'],['dogwalk','walk'],['Orienteering','run'],['orienteering','run'],['Pilgern','hike'],['bike_commute','bike'],['commute','bike'],['Cyclocross','racebike'],['cyclocross','racebike'],['BMX','other'],['bmx','other'],
   ['Splitboard','skitour'],['splitboard','skitour'],['Snowmobile','other'],['Rodeln','other'],['sled','other'],['IceSkate','other'],['iceskate','other'],['StandUpPaddling','kayak'],['sup','kayak'],
   ['Sail','other'],['sailing','other'],['Swim','other'],['swim','other'],['Snorkeling','other'],['Scuba diving','other'],['Tauchen','other'],['Surfing','other'],['Wakesurf','other'],['WaterSki','other'],['waterski','other'],
   ['Golf','other'],['Fishing','other'],['Archery','other'],['quad','other'],['atv','other'],['Motorcycle','other'],['motorbike','other'],['Workout','other']]) A.strictEqual(Sports.norm(s),e,s);
 for (const s of ['dogwalk','commute','sup','golf','x','',null,'ski','Snow','Rodeln']) A.ok(Sports.katalog.some(x=>x[0]===Sports.norm(s)),'norm liefert immer eine Katalog-Aktivität: '+s);
 A.ok(Sports.KAT.flatMap(k=>k[2]).sort().join()===Sports.katalog.map(x=>x[0]).sort().join(),'jede Aktivität des Katalogs in genau einer Kategorie');
 A.ok(!Sports.kategorien().flatMap(k=>k[2]).some(x=>x[0]==='ski') && Sports.kategorien('ski').flatMap(k=>k[2]).some(x=>x[0]==='ski'),'„Ski (allgemein)“ nur, wenn gewählt');
 A.strictEqual(Sports.label('bike'),'Radtour');A.strictEqual(Sports.katalog.length,29);A.strictEqual(Sports.list.length,30);A.deepStrictEqual(Sports.KAT.map(k=>k[1]),['Zu Fuß','Rad','Winter','Wasser','Outdoor und Sonstige']);A.strictEqual(Sports.label('mountaineering'),'Bergsteigen');A.strictEqual(Sports.label('snowshoe'),'Schneeschuhwandern');
 // 2.19.0: genau die endgültige Auswahl (Reihenfolge je Kategorie wie in aktivitaeten-final.md)
 A.deepStrictEqual(Sports.KAT.map(k=>k[2]),[['hike','walk','mountaineering','climbing','nordicwalking','run','trailrun'],['bike','racebike','mtb','gravel','ebike','emtb','bikepacking'],['skialpin','skitour','nordic','snowboard','snowshoe'],['kayak','rowing','dragonboat','rafting','boat'],['skateboard','inline','horse','paraglide','other']]);
 A.deepStrictEqual(['walk','climbing','mtb','snowshoe','inline','paraglide','bikepacking','rafting','boat','dragonboat'].map(Sports.label),['Spazieren / Gehen','Klettern / Klettersteig','Mountainbike','Schneeschuhwandern','Inlineskaten / Rollschuh','Gleitschirm','Bikepacking','Rafting','Bootfahren','Drachenboot']);
 {const f=Sports.farben();for(const [k] of Sports.list)A.ok(/^#[0-9a-f]{6}$/.test(f[k]),'Farbe '+k);
  const ICO=require('fs').readFileSync(__dirname+'/../android/app/src/main/assets/www/js/icons.js','utf8');for(const [k,,z] of Sports.list)A.ok(ICO.includes("'"+z.replace(/\ufe0f/g,'')+"':"),'Symbol für '+k+' '+z);}
 // Altdaten: entfernte Schlüssel bleiben an der Tour, zählen aber als ihr Rückfall (sonst Sonstiges)
 A.deepStrictEqual(['dogwalk','orienteering','commute','cyclocross','sup','splitboard','bmx','golf','sailing','gibtsnicht',undefined,'ski','hike'].map(Sports.anzeige),['walk','run','bike','racebike','kayak','skitour','other','other','other','other','other','ski','hike']);
 A.strictEqual(Sports.label('dogwalk'),'Spazieren / Gehen');A.strictEqual(Sports.label('sup'),'Kajak / Kanu');A.strictEqual(Sports.label('golf'),'Sonstiges');A.strictEqual(Sports.icon('commute'),Sports.icon('bike'));
 A.strictEqual(Sports.farben().dogwalk,Sports.farben().walk);A.ok(!Sports.bekannt('dogwalk')&&Sports.bekannt('ski')&&Sports.bekannt('paraglide'));
 for (const k of Object.keys(Sports.RUECKFALL)) A.ok(Sports.katalog.some(x=>x[0]===Sports.RUECKFALL[k])&&!Sports.bekannt(k),'Rückfall '+k);
 A.ok(Sports.passt('walk','dogwalk',[])&&Sports.passt('dogwalk','walk',[])&&Sports.passt('other','golf',[])&&!Sports.passt('hike','dogwalk',[])&&Sports.passt('grp:bike','commute',[])&&Sports.passt('grp:run','orienteering',[]),'Filter mit Altschlüsseln');
 A.deepStrictEqual(Sports.tags('snowshoe'),['Schneeschuh']);A.deepStrictEqual(Sports.tags('Snowshoe'),['Schneeschuh']);A.deepStrictEqual(Sports.tags('Schneeschuhwandern'),['Schneeschuh']);A.deepStrictEqual(Sports.tags('hike'),[]);A.deepStrictEqual(Sports.tags('skitour'),[]);A.deepStrictEqual(Sports.tags(''),[]);
 A.strictEqual(Sports.label('skitour'),'Skitour');A.strictEqual(Sports.label('skialpin'),'Ski alpin');A.strictEqual(Sports.label('nordic'),'Langlauf');A.strictEqual(Sports.label('ski'),'Ski (allgemein)');A.strictEqual(Sports.label('gibtsnicht'),'Sonstiges');A.strictEqual(Sports.label(undefined),'Sonstiges');A.strictEqual(Sports.icon('gibtsnicht'),'📍');
 A.ok(Sports.passt('', 'hike') && Sports.passt('grp:ski', 'nordic') && Sports.passt('grp:ski', 'ski') && !Sports.passt('grp:ski', 'hike') && Sports.passt('hike', 'hike') && !Sports.passt('hike', 'skitour'));
 A.deepStrictEqual(Sports.list.map(x=>x[0]).filter(x=>Sports.SKI.includes(x)).sort(),Sports.SKI.slice().sort(),'alle Skiarten stehen in der Liste');
 {const gx=t=>Geo.gpx('T',t,[{lat:47,lon:11,ele:500,t:1e12},{lat:47.001,lon:11,ele:520,t:1e12+60000}]).replace('<type>'+t+'</type>','<type>'+t+'</type>');
  for(const [t,sp,tg] of [['snowshoe','snowshoe',['Schneeschuh']],['skitour','skitour',[]],['skialpin','skialpin',[]],['nordic','nordic',[]],['hike','hike',[]]]){const q=await Parse.any('a.gpx',new TextEncoder().encode(gx(t)));A.strictEqual(q[0].sport,sp,t);A.deepStrictEqual(q[0].tags,tg,t);}}
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
 // 2.2.0: FIT-Sportnummern: 12 Langlauf, 13 Ski alpin (Untersportart 37: Skitour); 2.19.0: 14 Snowboard, 35 Schneeschuh (mit Schlagwort), 19/41/37 Kajak, 31 Klettern, 1/3 Trail, 42 Rafting, 23 Boot, 26 Gleitschirm; Schwimmen, Segeln, Golf, Eislaufen → Sonstiges
 for (const [sp,sub,e,tg] of [[12,0,'nordic',[]],[13,0,'skialpin',[]],[13,37,'skitour',[]],[14,0,'snowboard',[]],[35,0,'snowshoe',['Schneeschuh']],[17,0,'hike',[]],[1,0,'run',[]],[1,3,'trailrun',[]],[19,0,'kayak',[]],[5,0,'other',[]],[31,0,'climbing',[]],[16,0,'mountaineering',[]],[4,0,'other',[]],[37,0,'kayak',[]],[42,0,'rafting',[]],[23,0,'boat',[]],[26,0,'paraglide',[]],[27,0,'horse',[]],[32,0,'other',[]],[25,0,'other',[]],[33,0,'other',[]],[2,46,'gravel',[]],[21,0,'ebike',[]],[21,8,'emtb',[]]]) {
   const bs=[...b,0x41,0,0,18,0,2,5,1,0,6,1,0,0x01,sp,sub];
   const fs=new Uint8Array([14,0x10,0,0,bs.length&255,bs.length>>8,0,0,0x2e,0x46,0x49,0x54,0,0,...bs,0,0]);
   const q=Parse.fit(fs);A.strictEqual(q[0].sport,e,'FIT '+sp+'/'+sub);A.deepStrictEqual(q[0].tags,tg,'FIT-Schlagwort '+sp);
 }
 // 2.0.2: westliche Länge / südliche Breite (sint32 mit Vorzeichen) und „kein Wert“ (0x7FFFFFFF) – Punkte ohne Position entfallen
 {const bw=[...def,...rcd(1000000000,28.1038,-15.5657,520),...rcd(1000000001,180,180,521),...rcd(1000000002,-33.9,-70.6,522)];
  const dvx=new DataView(new Uint8Array(bw).buffer);dvx.setInt32(def.length+15+5,0x7FFFFFFF,true);dvx.setInt32(def.length+15+9,0x7FFFFFFF,true);
  const fw=new Uint8Array([14,0x10,0,0,bw.length&255,bw.length>>8,0,0,0x2e,0x46,0x49,0x54,0,0,...new Uint8Array(dvx.buffer),0,0]);
  const rw=Parse.fit(fw);A.strictEqual(rw[0].pts.length,2,'Punkt ohne Position entfällt');
  A.ok(Math.abs(rw[0].pts[0].lon+15.5657)<1e-5,'westliche Länge negativ: '+rw[0].pts[0].lon);A.ok(Math.abs(rw[0].pts[0].lat-28.1038)<1e-5);
  A.ok(Math.abs(rw[0].pts[1].lat+33.9)<1e-5&&Math.abs(rw[0].pts[1].lon+70.6)<1e-5,'Südhalbkugel');
  A.ok(Geo.stats(rw[0].pts).dist<2e7);}

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

 // Höhe aus Uhr: Absolutniveau der Tour, Verlauf vom Barometer
 const T0=1e12, tp=Array.from({length:20},(_,k)=>({t:T0+k*60000,ele:500+(k%2?6:-6)+(k%3?2:-2)}));
 const zs=(f)=>Array.from({length:30},(_,k)=>({t:T0+k*(19*60000/29),alt:f(k)}));
 const zl=zs(k=>480+80*k/29), al=Geo.alignAlt(tp,zl);
 const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s.length%2?s[s.length>>1]:(s[s.length/2-1]+s[s.length/2])/2};
 A.strictEqual(al.length,20); A.ok(Math.abs(med(al.map((v,i)=>v-tp[i].ele)))<=0.1,'Niveau');A.ok(Math.abs(med(al)-500)<=5,'Niveau '+med(al));   // Differenz zum Original im Median 0
 A.ok(Math.abs(al[19]-al[0]-80)<=1,'Anstieg '+(al[19]-al[0]));
 A.ok(Geo.alignAlt(tp,zs(k=>k%4?480+k:-20000))!==null);                       // Platzhalter werden ignoriert, Rest reicht
 A.strictEqual(Geo.alignAlt(tp,zs(k=>k<5?500+k:-20000)),null);                // weniger als 6 gültige Werte
 A.strictEqual(Geo.alignAlt(tp,zl.filter(p=>p.t<T0+10*60000)),null);          // Abdeckung unter 80 %
 A.strictEqual(Geo.alignAlt(tp.map(p=>({t:p.t,ele:null})),zl)[0],480);        // ohne Originalhöhen: Zepp unverändert
 console.log('OK');
})();
