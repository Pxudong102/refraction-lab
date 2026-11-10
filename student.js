(() => {
  const $ = s => document.querySelector(s);
  const cfg = window.APP_CONFIG || {};
  const status = $('#status');
  const configured = cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR_') && !cfg.supabaseAnonKey.includes('YOUR_');
  const db = configured && window.supabase && typeof window.supabase.createClient === 'function' ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  function show(msg, type='info') { status.textContent = msg; status.className = `status show ${type}`; }
  function buildClassName(){
    const grade=$('#gradeLevel').value;
    const raw=$('#classNumber').value.trim();
    const num=Number(raw);
    if(!grade||!raw||!Number.isInteger(num)||num<1||num>99) return '';
    return `${grade}（${num}）班`;
  }
  function updateClassPreview(){
    const name=buildClassName();
    $('#classPreview').textContent=name?`班级将统一记录为：${name}`:'班级将统一记录为：请选择年级和班级';
    $('#classPreview').classList.toggle('ready',!!name);
  }
  function addRow(i='', r='') {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="row-no"></td><td><input class="i-input" inputmode="decimal" value="${escapeHtml(i)}" placeholder="0–89"></td><td><input class="r-input" inputmode="decimal" value="${escapeHtml(r)}" placeholder="0–89"></td><td><button class="btn danger del-row" type="button" style="height:30px">删除</button></td>`;
    tr.querySelector('.del-row').addEventListener('click', () => { tr.remove(); renumber(); syncRatioControls(); scheduleRatioChart(); });
    $('#rowsBody').appendChild(tr); renumber(); scheduleRatioChart();
  }
  function escapeHtml(v){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renumber(){ [...document.querySelectorAll('.row-no')].forEach((e,i)=>e.textContent=i+1); }
  function clearRows(){ resetAllRatioCycles(); $('#rowsBody').innerHTML=''; for(let i=0;i<6;i++) addRow(); syncRatioControls(); scheduleRatioChart(); }
  function collectRows(){
    const out=[];
    for(const tr of $('#rowsBody').querySelectorAll('tr')){
      const i=parseFloat(tr.querySelector('.i-input').value.trim());
      const r=parseFloat(tr.querySelector('.r-input').value.trim());
      const blank=Number.isNaN(i)&&Number.isNaN(r);
      if(blank) continue;
      if(!Number.isFinite(i)||!Number.isFinite(r)||i<0||i>=90||r<0||r>=90) throw new Error('角度必须是 0°（含）到 90°（不含）之间的有效数字。');
      out.push({i:Number(i.toFixed(6)),r:Number(r.toFixed(6))});
    }
    return out;
  }
  function parsePaste(){
    const text=$('#pasteBox').value.trim(); if(!text){show('请先粘贴两列数据。','err');return;}
    const rows=[];
    for(const line of text.split(/\r?\n/)){
      const parts=line.trim().split(/[\t,，;； ]+/).filter(Boolean); if(parts.length<2) continue;
      const i=parseFloat(parts[0]); const r=parseFloat(parts[1]);
      if(Number.isFinite(i)&&Number.isFinite(r)) rows.push([i,r]);
    }
    if(!rows.length){show('没有识别到有效的 i、r 两列数字。','err');return;}
    resetAllRatioCycles(); $('#rowsBody').innerHTML=''; rows.forEach(x=>addRow(x[0],x[1])); syncRatioControls(); scheduleRatioChart(); show(`已识别 ${rows.length} 组测量数据。`,'ok');
  }
  async function submit(){
    if(!db){show('云端连接脚本尚未就绪，请检查网络或稍后重试；已填写的数据仍保留在本页。','err');return;}
    const class_name=buildClassName(), group_name=$('#groupName').value.trim(), student_code=$('#studentCode').value.trim(), medium=$('#medium').value.trim(), note=$('#note').value.trim();
    if(!class_name){show('请选择年级，并填写有效的班级数字（1–99）。','err');return;}
    if(!group_name){show('请填写组别。','err');return;}
    let measurements; try{measurements=collectRows();}catch(e){show(e.message,'err');return;}
    if(measurements.length<2){show('请至少录入 2 组有效测量数据。','err');return;}
    const btn=$('#submitBtn'); btn.disabled=true; btn.textContent='正在提交…';
    const {error}=await db.from('submissions').insert({class_name,group_name,student_code:student_code||null,medium:medium||null,note:note||null,measurements});
    btn.disabled=false; btn.textContent='提交本组实验数据';
    if(error){show(`提交失败：${error.message}`,'err');return;}
    show(`提交成功：${measurements.length} 个数据点。可以关闭页面或继续修改后再次提交。`,'ok');
  }

  // 四比值图只读取本页尚未提交的 i、r 数据；不会读写数据库。
  const ratioColors={angle:'#0d93c7',cos:'#c68a17',tan:'#9263d7',sin:'#24a879'};
  const ratioSeries=[['angle','i / r'],['cos','cos i / cos r'],['tan','tan i / tan r'],['sin','sin i / sin r']];
  const toRadians=deg=>deg*Math.PI/180;
  let ratioFrame=0;
  // 与教师分析平台相同的四态循环：空闲 → 绘制中 → 完成 → 清除回空闲
  // 兼容较旧的华为平板浏览器：避免 Object.fromEntries 不支持时整份脚本中断
  const ratioCycles={};
  const ratioBtns={};
  const ratioNames={};
  ratioSeries.forEach(([key,name])=>{
    ratioCycles[key]={phase:'idle',visible:0,timer:null};
    ratioNames[key]=name;
  });
  document.querySelectorAll('.ratio-cycle-btn').forEach(btn=>{
    ratioBtns[btn.dataset.ratio]=btn;
  });
  function validRatioPoints(rows,key){return rows.filter(row=>Number.isFinite(row[key]));}
  function stopRatioTimer(key){const s=ratioCycles[key];if(s.timer!==null)clearInterval(s.timer);s.timer=null;}
  function resetAllRatioCycles(){
    for(const [key] of ratioSeries){stopRatioTimer(key);ratioCycles[key].phase='idle';ratioCycles[key].visible=0;}
    syncRatioControls();
  }
  function syncRatioControls(){
    const {rows}=getPreviewRows();
    for(const [key] of ratioSeries){
      const s=ratioCycles[key],b=ratioBtns[key];
      if(!b)continue;
      const usable=validRatioPoints(rows,key).length;
      // 曲线绘制至少需要2个有效点；不影响已完整画出的其它曲线。
      if(usable<2 && s.phase!=='idle'){
        stopRatioTimer(key);s.phase='idle';s.visible=0;
      }
      b.disabled=usable<2;
      b.classList.toggle('running',s.phase==='running');
      b.classList.toggle('done',s.phase==='done');
      b.setAttribute('aria-pressed',s.phase==='done'?'true':'false');
      b.textContent=({angle:'① ',cos:'② ',tan:'③ ',sin:'④ '})[key]+
        (s.phase==='done'?'已绘 '+ratioNames[key]+' · 点击清除':s.phase==='running'?'绘制中 · 点击补齐':'绘制 '+ratioNames[key]);
    }
  }
  function finishRatio(key){
    const s=ratioCycles[key];stopRatioTimer(key);
    s.phase='done';s.visible=validRatioPoints(getPreviewRows().rows,key).length;
    syncRatioControls();scheduleRatioChart();
  }
  function clickRatio(key){
    const s=ratioCycles[key];if(!s)return;
    const pts=validRatioPoints(getPreviewRows().rows,key);
    if(s.phase==='running'){finishRatio(key);return;}
    if(s.phase==='done'){
      stopRatioTimer(key);s.phase='idle';s.visible=0;
      syncRatioControls();scheduleRatioChart();return;
    }
    if(pts.length<2)return;
    s.phase='running';s.visible=1; // 首点立即出现，之后逐点完成连线
    s.timer=setInterval(()=>{
      const current=validRatioPoints(getPreviewRows().rows,key);
      if(current.length<2){stopRatioTimer(key);s.phase='idle';s.visible=0;syncRatioControls();scheduleRatioChart();return;}
      s.visible=Math.min(current.length,s.visible+1);
      if(s.visible>=current.length)finishRatio(key);
      else{syncRatioControls();scheduleRatioChart();}
    },310);
    syncRatioControls();scheduleRatioChart();
  }
  Object.keys(ratioBtns).forEach(key=>ratioBtns[key].addEventListener('click',()=>clickRatio(key)));

  function getPreviewRows(){
    const rows=[];let incomplete=0,invalid=0,zeroDenominator=0;
    for(const tr of $('#rowsBody').querySelectorAll('tr')){
      const rawI=tr.querySelector('.i-input').value.trim();
      const rawR=tr.querySelector('.r-input').value.trim();
      if(!rawI&&!rawR)continue;
      if(!rawI||!rawR){incomplete++;continue;}
      const i=Number(rawI),r=Number(rawR);
      if(!Number.isFinite(i)||!Number.isFinite(r)||i<0||i>=90||r<0||r>=90){invalid++;continue;}
      const si=Math.sin(toRadians(i)),sr=Math.sin(toRadians(r));
      const ci=Math.cos(toRadians(i)),cr=Math.cos(toRadians(r));
      const ti=Math.tan(toRadians(i)),trv=Math.tan(toRadians(r));
      const ratio=(num,den)=>Math.abs(den)>1e-12?num/den:null;
      if(r===0)zeroDenominator++;
      const round2=v=>v==null?null:Math.round((v+Number.EPSILON)*100)/100;
      rows.push({i,r,angle:round2(ratio(i,r)),cos:round2(ratio(ci,cr)),tan:round2(ratio(ti,trv)),sin:round2(ratio(si,sr))});
    }
    rows.sort((a,b)=>a.i-b.i);
    return {rows,incomplete,invalid,zeroDenominator};
  }

  function tickLabel(v){
    if(Math.abs(v)<1e-9)return '0';
    if(Math.abs(v)>=100)return v.toFixed(0);
    if(Math.abs(v)>=10)return v.toFixed(1).replace(/\.0$/,'');
    return v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
  }

  function drawRatioChart(){
    const canvas=$('#ratioChart');if(!canvas)return;
    const rect=canvas.getBoundingClientRect();
    const w=rect.width,h=rect.height;
    if(w<40||h<60)return;
    const dpr=Math.min(2.5,window.devicePixelRatio||1);
    const targetW=Math.round(w*dpr),targetH=Math.round(h*dpr);
    if(canvas.width!==targetW)canvas.width=targetW;
    if(canvas.height!==targetH)canvas.height=targetH;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const {rows,incomplete,invalid,zeroDenominator}=getPreviewRows();
    $('#ratioPointCount').textContent=`有效数据点：${rows.length}`;
    const status=[];
    if(rows.length>=2){
      const drawn=ratioSeries.filter(([key])=>ratioCycles[key].phase==='done').length;
      const running=ratioSeries.filter(([key])=>ratioCycles[key].phase==='running').length;
      status.push(running?`正在绘制 ${running} 条曲线；绘制中再点立即完成`:drawn?`已完成 ${drawn} 条曲线；点击实心按钮可以清除对应曲线`:'点击上方按钮逐条绘制比值曲线');
    }else status.push('请先录入至少 2 组完整的 i、r 数据');
    if(incomplete)status.push(`${incomplete} 行尚未填完整`);
    if(invalid)status.push(`${invalid} 行角度不合法`);
    if(zeroDenominator)status.push('r=0 的部分比值未绘制');
    $('#ratioChartStatus').textContent=status.join('；')+'。';

    const pad={left:w<470?47:65,right:w<470?12:26,top:22,bottom:w<470?48:54};
    const iw=Math.max(1,w-pad.left-pad.right),ih=Math.max(1,h-pad.top-pad.bottom);
    const values=rows.flatMap(row=>ratioSeries.map(([k])=>row[k])).filter(Number.isFinite);
    const xs=rows.map(row=>row.i);
    const minX=xs.length?Math.max(0,Math.min(...xs)-5):0;
    const maxX=xs.length?Math.min(90,Math.max(...xs)+5):90;
    let minY=0,maxY=2.5;
    if(values.length){
      let low=Math.min(...values),high=Math.max(...values);
      if(Math.abs(high-low)<1e-7){low-=0.2;high+=0.2;}
      const margin=(high-low)*0.16;
      minY=Math.max(0,low-margin);maxY=high+margin;
      if(maxY-minY<0.3)maxY=minY+0.3;
    }
    const xSpan=Math.max(1,maxX-minX),ySpan=Math.max(0.0001,maxY-minY);
    const X=x=>pad.left+(x-minX)/xSpan*iw;
    const Y=y=>pad.top+ih-(y-minY)/ySpan*ih;
    ctx.font=(w<470?'10':'11')+'px Microsoft YaHei, system-ui, sans-serif';
    ctx.lineWidth=1;
    ctx.textBaseline='middle';
    for(let j=0;j<=4;j++){
      const v=minY+(maxY-minY)*j/4,y=Y(v);
      ctx.strokeStyle='#e6edf3';ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke();
      ctx.fillStyle='#6b8292';ctx.textAlign='right';ctx.fillText(tickLabel(v),pad.left-8,y);
    }
    for(let j=0;j<=6;j++){
      const v=minX+(maxX-minX)*j/6,x=X(v);
      ctx.strokeStyle='#edf2f7';ctx.beginPath();ctx.moveTo(x,pad.top);ctx.lineTo(x,pad.top+ih);ctx.stroke();
      ctx.fillStyle='#6b8292';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(tickLabel(v),x,pad.top+ih+9);
    }
    ctx.strokeStyle='#c9d9e4';ctx.lineWidth=1.2;ctx.strokeRect(pad.left,pad.top,iw,ih);
    ctx.fillStyle='#496b83';ctx.font='11px Microsoft YaHei, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='alphabetic';
    ctx.fillText('入射角 i / °',pad.left+iw/2,h-12);
    ctx.save();ctx.translate(w<470?13:19,pad.top+ih/2);ctx.rotate(-Math.PI/2);ctx.fillText('比值',0,0);ctx.restore();

    // 坐标范围由四条曲线的全部有效值统一计算，避免每条曲线绘制时纵轴跳动。
    ctx.save();ctx.beginPath();ctx.rect(pad.left,pad.top,iw,ih);ctx.clip();
    for(const [key] of ratioSeries){
      const cycle=ratioCycles[key];
      if(cycle.phase==='idle')continue;
      const allPts=rows.filter(row=>Number.isFinite(row[key]));
      const pts=cycle.phase==='done'?allPts:allPts.slice(0,cycle.visible);
      if(!pts.length)continue;
      ctx.lineWidth=2.2;ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=ratioColors[key];
      if(pts.length>=2){ctx.beginPath();pts.forEach((p,j)=>j?ctx.lineTo(X(p.i),Y(p[key])):ctx.moveTo(X(p.i),Y(p[key])));ctx.stroke();}
      ctx.fillStyle=ratioColors[key];ctx.strokeStyle='#fff';ctx.lineWidth=1.2;
      for(const p of pts){ctx.beginPath();ctx.arc(X(p.i),Y(p[key]),3.5,0,Math.PI*2);ctx.fill();ctx.stroke();}
    }
    ctx.restore();
    if(rows.length<2){
      ctx.fillStyle='#748fa1';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font=(w<470?'11':'13')+'px Microsoft YaHei, system-ui, sans-serif';
      ctx.fillText('请输入至少两组完整的 i、r 数据',pad.left+iw/2,pad.top+ih/2);
    }else if(ratioSeries.every(([k])=>ratioCycles[k].phase==='idle')){
      ctx.fillStyle='#839bae';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font=(w<470?'11':'13')+'px Microsoft YaHei, system-ui, sans-serif';
      ctx.fillText('点击上方按钮，逐条绘制四种比值',pad.left+iw/2,pad.top+ih/2);
    }
  }
  function scheduleRatioChart(){
    if(ratioFrame)return;
    ratioFrame=requestAnimationFrame(()=>{ratioFrame=0;drawRatioChart();});
  }
  $('#rowsBody').addEventListener('input',()=>{syncRatioControls();scheduleRatioChart();});
  window.addEventListener('resize',scheduleRatioChart,{passive:true});
  if(typeof ResizeObserver!=='undefined'){
    const observer=new ResizeObserver(scheduleRatioChart);
    observer.observe($('.ratio-canvas-wrap'));
  }

  $('#gradeLevel').addEventListener('change',updateClassPreview);
  $('#classNumber').addEventListener('input',updateClassPreview);
  $('#addRowBtn').addEventListener('click',()=>addRow());
  $('#clearRowsBtn').addEventListener('click',clearRows);
  $('#parseBtn').addEventListener('click',parsePaste);
  $('#submitBtn').addEventListener('click',submit);
  clearRows();
  updateClassPreview();
  if(!configured) show('当前是未配置状态：教师完成 Supabase 配置后即可在线提交。','info');
})();
