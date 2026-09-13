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
