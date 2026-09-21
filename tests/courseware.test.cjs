const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const retrieval=require('../server/retrieval.cjs');
const courseware=require('../server/courseware.cjs');

const SOURCES_DIR=path.join(__dirname,'..','knowledge','sources');
const BIO_DIR=path.join(__dirname,'..','knowledge','biographies');
const sources=fs.readdirSync(SOURCES_DIR).filter(file=>file.endsWith('.source.json'))
 .map(file=>JSON.parse(fs.readFileSync(path.join(SOURCES_DIR,file),'utf8')));
const bios=courseware.loadBiographies(BIO_DIR);

test('中文不引分词器：单字 + 相邻两字当词元',()=>{
 const tokens=retrieval.tokenize('儿童歌舞剧 abc 1920');
 assert.ok(tokens.includes('儿童'));
 assert.ok(tokens.includes('童歌'));
 assert.ok(tokens.includes('歌舞'));
 assert.ok(tokens.includes('舞剧'));
 assert.ok(!tokens.includes('歌舞剧'));   // 三个字不成一个词元，只由单字与相邻两字拼出来
 assert.ok(tokens.includes('童'));
 assert.ok(tokens.includes('abc'));
 assert.ok(tokens.includes('1920'));
 assert.equal(retrieval.tokenize('').length,0);
});

test('没有 cite 的材料根本不会成为材料块',()=>{
 const chunks=retrieval.chunkBiography({id:'bio-x',summary:'有出处的总述',sources:['src-a'],facts:[
  {id:'f1',text:'有出处的事实',cite:['src-a']},
  {id:'f2',text:'没有出处的事实'},
 ],activities:[{id:'a1',text:'没出处的活动'}]});
 assert.deepEqual(chunks.map(chunk=>chunk.kind).sort(),['fact','summary']);
 assert.deepEqual(chunks.map(chunk=>chunk.id).sort(),['bio-x#f1','bio-x#summary']);
});

test('检索能解释为什么选出这一段：返回命中词元',()=>{
 const retriever=retrieval.createRetriever(bios);
 const hits=retriever.search('儿童歌舞剧',{limit:5});
 assert.ok(hits.length>0);
 assert.equal(hits[0].chunk.bioId,'bio-lijinhui');
 assert.ok(hits[0].matched.length>0);
 assert.ok(hits[0].score>0);
 // 换一个主题就换一段材料，说明召回是按内容而不是按固定顺序
 const folk=retriever.search('鲜花调 版本');
 assert.equal(folk[0].chunk.bioId,'bio-molihua');
});

test('生成课件：封面 → 总述 → 事实卡 → 课堂活动 → 引用页，每句都能引到出处',()=>{
 const built=courseware.buildCourseware({bios,sources,lesson:null,options:{bioIds:['bio-lijinhui'],theme:'音乐与土地'},asOf:'2026-09-13'});
 assert.deepEqual(built.slides.map(slide=>slide.layout),['cover','summary','facts','facts','facts','activity','citations']);
 for(const slide of built.slides){
  for(const bullet of slide.bullets){
   assert.ok(bullet.cite.length>0,`「${bullet.text}」没有引用`);
   for(const id of bullet.cite)assert.ok(sources.some(source=>source.id===id),`引用了未登记的来源 ${id}`);
   assert.ok(bullet.sourceTitles.length===bullet.cite.length);
  }
  assert.ok(slide.id.startsWith('slide-'));
 }
 // 引用页列出的是「引用到的来源」，不是「仓库里所有来源」
 assert.deepEqual(built.citations.map(item=>item.sourceId).sort(),['src-eol-zh-music','src-xiaotuzi-lijinhui-1920']);
 const music=built.citations.find(item=>item.sourceId==='src-eol-zh-music');
 assert.equal(music.tier,'link-only');
 assert.ok(music.licenseLabel.length>0);
 assert.equal(built.dropped.length,0);
 assert.ok(built.stats.bullets>0);
 assert.ok(built.stats.activityMinutes>0);
});

test('无来源即不输出：引不到出处的句子被丢弃，丢空的幻灯片整张丢弃',()=>{
 const bad={id:'bio-bad',title:'引不到出处的材料',subtitle:'',summary:'这句话引不到出处。',sources:['src-nope'],facts:[{id:'f1',text:'这句也引不到。',cite:['src-nope']}],activities:[]};
 const built=courseware.buildCourseware({bios:[bad],sources,asOf:'2026-09-13'});
 assert.deepEqual(built.slides.map(slide=>slide.layout),['cover','citations']);
 assert.ok(built.dropped.length>=2);
 assert.ok(built.dropped.some(item=>/无来源即不输出/.test(item.reason)));
 assert.ok(built.dropped.some(item=>/整张丢弃/.test(item.reason)));
 assert.ok(built.dropped.every(item=>Array.isArray(item.missing)));
 assert.equal(built.stats.bullets,0);
});

test('材料没核对过就全程带「待人工核对」，不静默通过',()=>{
 const built=courseware.buildCourseware({bios,sources,options:{bioIds:['bio-molihua']},asOf:'2026-09-13'});
 assert.equal(built.pendingReview,true);
 assert.ok(built.pendingReasons.length>0);
 assert.ok(built.pendingReasons.some(reason=>/《茉莉花》/.test(reason)));
 const html=courseware.renderSlidesHtml(built);
 assert.match(html,/待人工核对/);
 assert.match(html,/引用与许可/);

 // 已核对过的来源出现在引用页时不再标「待核对」
 const stillPending=built.citations.find(item=>item.sourceId==='src-guoxue-molihua-qupai');
 assert.equal(stillPending.verifiedBy,null);
});

test('独立课件页：自带翻页、支持打印、每句都带出处',()=>{
 const built=courseware.buildCourseware({bios,sources,options:{bioIds:['bio-lijinhui']},asOf:'2026-09-13'});
 const html=courseware.renderSlidesHtml(built);
 assert.match(html,/^<!DOCTYPE html>/);
 assert.match(html,/ArrowRight/);           // 方向键翻页
 assert.match(html,/@media print/);         // 打印导出 PDF
 assert.match(html,/出处：/);
 assert.equal((html.match(/class="slide/g)||[]).length,built.slides.length);
 assert.doesNotMatch(html,/undefined/);
});

test('本课曲目那张引用的是乐谱来源，乐谱来源没登记就整张不出现',()=>{
 const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'..','public','lessons','molihua.lesson.json'),'utf8'));
 const built=courseware.buildCourseware({bios,sources,lesson,difficulty:require('../server/difficulty.cjs').analyze(lesson),options:{bioIds:['bio-molihua']},asOf:'2026-09-13'});
 const lessonSlide=built.slides.find(slide=>slide.layout==='lesson');
 assert.ok(lessonSlide);
 assert.deepEqual(lessonSlide.citations,['src-molihua-arthn-2021']);
 assert.match(lessonSlide.bullets[0].text,/4\/4/);

 // 把乐谱来源登记撤掉 → 这一张整张消失，而不是留下没有出处的字
 const built2=courseware.buildCourseware({bios,sources:sources.filter(source=>source.id!=='src-molihua-arthn-2021'),lesson,options:{bioIds:['bio-molihua']},asOf:'2026-09-13'});
 assert.equal(built2.slides.find(slide=>slide.layout==='lesson'),undefined);
});

test('分镜脚本：一镜一格，时长与画面旁白都写清楚，并能导成 Markdown',()=>{
 const built=courseware.buildCourseware({bios,sources,options:{bioIds:['bio-lijinhui']},asOf:'2026-09-13'});
 const story=courseware.buildStoryboard(built);
 assert.equal(story.shots.length,built.slides.length);
 assert.ok(story.totalSeconds>0);
 assert.equal(story.totalSeconds,story.shots.reduce((sum,shot)=>sum+shot.seconds,0));
 assert.equal(story.shots[0].shot,1);
 assert.ok(story.shots.every(shot=>shot.visual.length>0));
 assert.ok(story.shots.some(shot=>shot.narration.includes('黎锦晖')));
 const markdown=courseware.storyboardMarkdown(story);
 assert.match(markdown,/^# .+· 分镜脚本/m);
 assert.equal((markdown.match(/^## 第 /gm)||[]).length,story.shots.length);
});

test('视频档 1：给可运行的合成方案，并如实报告 ffmpeg 在不在',()=>{
 const built=courseware.buildCourseware({bios,sources,options:{bioIds:['bio-lijinhui']},asOf:'2026-09-13'});
 const story=courseware.buildStoryboard(built);
 const script=courseware.renderFfmpegScript(story,{audioFile:'public/assets/audio/x.wav'});
 // concat 解复用器：每镜一张图 + 自己的时长；末尾重复最后一张，最后一张才显示满时长
 assert.equal((script.slidesConcat.match(/^file /gm)||[]).length,story.shots.length+1);
 assert.equal((script.slidesConcat.match(/^duration /gm)||[]).length,story.shots.length);
 assert.match(script.slidesConcat,/^ffconcat version 1\.0/);
 assert.match(script.slidesConcat,/^file 'slides\/slide-01\.png'$/m);
 assert.equal((script.slidesConcat.match(/^file .*$/gm)||[]).pop(),`file 'slides/slide-${String(story.shots.length).padStart(2,'0')}.png'`);
 assert.match(script.ffmpegCommand,/ffmpeg -y -f concat/);
 assert.match(script.ffmpegCommand,/public\/assets\/audio\/x\.wav/);
 assert.match(script.ffmpegCommand,/1920:1080/);

 const ffmpeg=courseware.detectFfmpeg();
 assert.equal(typeof ffmpeg.available,'boolean');
 if(!ffmpeg.available)assert.match(ffmpeg.hint,/ffmpeg/);
});

test('幻灯片矢量图：不靠浏览器也能出图，转 PNG 后就能进 ffmpeg',()=>{
 const built=courseware.buildCourseware({bios,sources,options:{bioIds:['bio-lijinhui']},asOf:'2026-09-13'});
 built.slides.forEach((slide,index)=>{
  const svg=courseware.renderSlideSvg(slide,{index:index+1,total:built.slides.length,courseware:built});
  assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg,/width="1920" height="1080"/);
  assert.ok(svg.includes(`${index+1} / ${built.slides.length}</text>`));
  assert.doesNotMatch(svg,/<[^>]*>\s*undefined/);
 });
});

test('PPTX 导出：ZIP 结构合法、CRC 一致、每张幻灯片都有对应条目与文本',()=>{
 const built=courseware.buildCourseware({bios,sources,options:{bioIds:['bio-lijinhui']},asOf:'2026-09-13'});
 const pptx=courseware.buildPptx(built);
 assert.ok(Buffer.isBuffer(pptx));
 assert.equal(pptx.toString('ascii',0,2),'PK');
 // 按 EOCD 规范解析：sig(0) disk(4) cdDisk(6) entriesThisDisk(8) entriesTotal(10) cdSize(12) cdOffset(16)
 const eocd=pptx.length-22;
 assert.equal(pptx.readUInt32LE(eocd),0x06054b50);
 const entries=pptx.readUInt16LE(eocd+10),cdSize=pptx.readUInt32LE(eocd+12),cdStart=pptx.readUInt32LE(eocd+16);
 assert.equal(entries,built.slides.length*2+9,'每张幻灯片 xml+rels，另加 content-types/.rels/presentation+rels/master+rels/layout+rels/theme');
 assert.equal(pptx.toString('ascii',cdStart,cdStart+4),'PK\x01\x02');
 const names=[];let p=cdStart;
 for(let i=0;i<entries;i+=1){
  assert.equal(pptx.readUInt32LE(p),0x02014b50);
  const crc=pptx.readUInt32LE(p+16),size=pptx.readUInt32LE(p+24),nameLen=pptx.readUInt16LE(p+28),extraLen=pptx.readUInt16LE(p+30),commentLen=pptx.readUInt16LE(p+32),localOffset=pptx.readUInt32LE(p+42);
  const name=pptx.slice(p+46,p+46+nameLen).toString('utf8');names.push(name);
  // 回读本地头与数据，重算 CRC 对上
  assert.equal(pptx.readUInt32LE(localOffset),0x04034b50,'local header of '+name);
  const lNameLen=pptx.readUInt16LE(localOffset+26),lExtraLen=pptx.readUInt16LE(localOffset+28);
  const data=pptx.slice(localOffset+30+lNameLen+lExtraLen,localOffset+30+lNameLen+lExtraLen+size);
  assert.equal(crc32Of(data),crc,'crc mismatch for '+name);
  p+=46+nameLen+extraLen+commentLen;
 }
 assert.equal(p,cdStart+cdSize,'central directory size consistent');
 for(let i=1;i<=built.slides.length;i+=1)assert.ok(names.includes(`ppt/slides/slide${i}.xml`),`slide${i} entry present`);
 assert.ok(names.includes('[Content_Types].xml')&&names.includes('ppt/presentation.xml')&&names.includes('ppt/theme/theme1.xml'));
 // 幻灯片内容是文本框：正文里能找到事实文本与出处行，且「出处」不缺失
 const slide1=pptxEntry(pptx,names,'ppt/slides/slide1.xml').toString('utf8');
 assert.match(slide1,/p:spTree/);
 const bodySlide=pptxEntry(pptx,names,'ppt/slides/slide2.xml').toString('utf8');
 assert.match(bodySlide,/出处：/);
 assert.match(bodySlide,/Microsoft YaHei/);
});
const CRC_TABLE_LOCAL=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n+=1){let c=n;for(let k=0;k<8;k+=1)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32Of(buf){let c=0xffffffff;for(const b of buf)c=CRC_TABLE_LOCAL[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0}
function pptxEntry(zip,names,name){const idx=names.indexOf(name);let p=zip.length-22;const cdStart=zip.readUInt32LE(p+16);p=cdStart;for(let i=0;i<=idx;i+=1){if(i===idx){const size=zip.readUInt32LE(p+24),nameLen=zip.readUInt16LE(p+28),extraLen=zip.readUInt16LE(p+30),commentLen=zip.readUInt16LE(p+32),localOffset=zip.readUInt32LE(p+42);const lNameLen=zip.readUInt16LE(localOffset+26),lExtraLen=zip.readUInt16LE(localOffset+28);return zip.slice(localOffset+30+lNameLen+lExtraLen,localOffset+30+lNameLen+lExtraLen+size)}p+=46+zip.readUInt16LE(p+28)+zip.readUInt16LE(p+30)+zip.readUInt16LE(p+32)}}

test('视频合成环境：如实报告 ffmpeg 与 Edge，Edge 探测不弹窗不落盘',()=>{
 const edge=courseware.detectEdge();
 assert.equal(typeof edge.available,'boolean');
 if(!edge.available)assert.match(edge.hint,/Edge/);
 const ff=courseware.detectFfmpeg();
 assert.equal(typeof ff.available,'boolean');
 if(ff.available)assert.ok(ff.command,'available ffmpeg exposes the command actually probed');
});
