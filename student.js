(() => {
  const $ = s => document.querySelector(s);
  const cfg = window.APP_CONFIG || {};
  const status = $('#status');
  const configured = cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR_') && !cfg.supabaseAnonKey.includes('YOUR_');
  const db = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

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
    tr.querySelector('.del-row').addEventListener('click', () => { tr.remove(); renumber(); scheduleRatioChart(); });
    $('#rowsBody').appendChild(tr); renumber(); scheduleRatioChart();
  }
  function escapeHtml(v){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renumber(){ [...document.querySelectorAll('.row-no')].forEach((e,i)=>e.textContent=i+1); }
  function clearRows(){ $('#rowsBody').innerHTML=''; for(let i=0;i<6;i++) addRow(); scheduleRatioChart(); }
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
    $('#rowsBody').innerHTML=''; rows.forEach(x=>addRow(x[0],x[1])); scheduleRatioChart(); show(`已识别 ${rows.length} 组测量数据。`,'ok');
  }
  async function submit(){
    if(!configured){show('网站尚未连接 Supabase，请教师先完成 config.js 配置。','err');return;}
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
      rows.push({i,r,angle:ratio(i,r),cos:ratio(ci,cr),tan:ratio(ti,trv),sin:ratio(si,sr)});
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
    if(rows.length>=2)status.push(`已根据 ${rows.length} 个数据点更新四比值图`);
    else status.push('请录入至少 2 组完整数据，图表将自动更新');
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
      const pts=rows.filter(row=>Number.isFinite(row[key]));
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
      ctx.fillText('输入至少两组 i、r 数据后自动绘制',pad.left+iw/2,pad.top+ih/2);
    }
  }
  function scheduleRatioChart(){
    if(ratioFrame)return;
    ratioFrame=requestAnimationFrame(()=>{ratioFrame=0;drawRatioChart();});
  }
  $('#rowsBody').addEventListener('input',scheduleRatioChart);
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
