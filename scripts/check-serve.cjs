const http=require('http');
function get(path){return new Promise((resolve,reject)=>{const req=http.get('http://127.0.0.1:4173'+path,res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve({status:res.statusCode,body:s}))});req.on('error',reject)})}
(async()=>{
  const idx=await get('/');
  console.log('index.html status',idx.status,'has display-ui.js tag?',idx.body.includes('display-ui.js'));
  console.log('index.html tail:',idx.body.slice(-180));
  const js=await get('/display-ui.js');
  console.log('display-ui.js status',js.status,'len',js.body.length,'head',js.body.slice(0,80));
  const css=await get('/display.css');
  console.log('display.css status',css.status,'len',css.body.length);
})();
