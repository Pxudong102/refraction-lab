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
    tr.querySelector('.del-row').addEventListener('click', () => { tr.remove(); renumber(); });
    $('#rowsBody').appendChild(tr); renumber();
  }
  function escapeHtml(v){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renumber(){ [...document.querySelectorAll('.row-no')].forEach((e,i)=>e.textContent=i+1); }
  function clearRows(){ $('#rowsBody').innerHTML=''; for(let i=0;i<6;i++) addRow(); }
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
    $('#rowsBody').innerHTML=''; rows.forEach(x=>addRow(x[0],x[1])); show(`已识别 ${rows.length} 组测量数据。`,'ok');
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
    // 仅在云端提交成功后，把本组本次实验的原始 i、r 副本保存到当前浏览器。
    // 自主探究页只读取这个本地副本，不查询 submissions 表，避免学生读取其他组数据。
    let localSaved=true;
    try{
      const localIdentity=[class_name,group_name].join('|');
      const storageKey='refraction_self_inquiry_v1_'+encodeURIComponent(localIdentity);
      let saved=[];
      try{saved=JSON.parse(localStorage.getItem(storageKey)||'[]');}catch(_){saved=[];}
      const record={
        class_name,group_name,student_code:student_code||'',
        medium:medium||'未填写介质',note,
        measurements:measurements.map(p=>({i:p.i,r:p.r})),
        uploaded_at:new Date().toISOString()
      };
      const mediumKey=String(record.medium).trim().toLowerCase();
      // 同一介质重复提交时以最新一次为准；不同介质分别保留。
      if(mediumKey && mediumKey!=='未填写介质'){
        saved=saved.filter(x=>String(x.medium||'').trim().toLowerCase()!==mediumKey);
      }
      saved.push(record);
      saved.sort((a,b)=>String(a.uploaded_at||'').localeCompare(String(b.uploaded_at||'')));
      saved=saved.slice(-2);
      localStorage.setItem(storageKey,JSON.stringify(saved));
      // 新提交会改变实验内容，清除旧的阶段完成状态，要求学生重新完成探究。
      localStorage.removeItem(storageKey+'_inquiry_progress');
      localStorage.setItem('refraction_self_inquiry_last_key',storageKey);
    }catch(storageError){
      localSaved=false;
      console.warn('本地自主探究数据保存失败：',storageError);
    }
    show(localSaved
      ? `提交成功：${measurements.length} 个数据点，已同步到本机自主探究平台。`
      : `云端提交成功，但本机自主探究数据保存失败。请检查浏览器存储设置后重新提交。`,'ok');
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
