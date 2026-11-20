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
    const grade_level=$('#gradeLevel').value.trim(), class_number=$('#classNumber').value.trim();
    const class_name=buildClassName(), group_name=$('#groupName').value.trim(), student_code=$('#studentCode').value.trim(), medium=$('#medium').value.trim(), note=$('#note').value.trim();
    if(!grade_level){show('请选择年级。','err');$('#gradeLevel').focus();return;}
    if(!class_number||!class_name){show('请填写有效的班级数字（1–99）。','err');$('#classNumber').focus();return;}
    if(!group_name){show('请填写组别。','err');$('#groupName').focus();return;}
    if(!medium){show('请填写本组实验的介质名称，例如：水、玻璃、介质1。','err');$('#medium').focus();return;}
    let measurements; try{measurements=collectRows();}catch(e){show(e.message,'err');return;}
    if(measurements.length<2){show('请至少录入 2 组有效测量数据。','err');return;}
    const btn=$('#submitBtn'); btn.disabled=true; btn.textContent='正在提交…';
    const {error}=await db.from('submissions').insert({class_name,group_name,student_code:student_code||null,medium:medium||null,note:note||null,measurements});
    btn.disabled=false; btn.textContent='提交本组实验数据';
    if(error){show(`提交失败：${error.message}`,'err');return;}
    // 云端成功后，将本次实验追加保存到当前浏览器的本组数据清单。
    // 每次上传都是独立记录，不覆盖同一介质的历史记录，也不只保留两份。
    let localSaved=true;
    let storageKey='';
    try{
      const localIdentity=[grade_level,class_number,class_name,group_name].join('|');
      storageKey='refraction_self_inquiry_v2_'+encodeURIComponent(localIdentity);
      let saved=[];
      try{saved=JSON.parse(localStorage.getItem(storageKey)||'[]');}catch(_){saved=[];}
      const record={
        grade_level,class_number,class_name,group_name,student_code:student_code||'',
        medium,note,
        measurements:measurements.map(p=>({i:p.i,r:p.r})),
        uploaded_at:new Date().toISOString(),
        record_id:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)
      };
      saved.push(record);
      // 本地最多保留30份，避免浏览器存储无限增长；正常课堂远低于此数量。
      saved=saved.slice(-30);
      localStorage.setItem(storageKey,JSON.stringify(saved));
      localStorage.removeItem(storageKey+'_inquiry_progress');
      localStorage.setItem('refraction_self_inquiry_last_key',storageKey);
      localStorage.setItem('refraction_self_inquiry_identity',JSON.stringify({grade_level,class_number,class_name,group_name}));
    }catch(storageError){
      localSaved=false;
      console.warn('本地自主探究数据保存失败：',storageError);
    }
    show(localSaved
      ? `提交成功：${measurements.length} 个测量点；已保存为“${medium}”，本组目前共有 ${getSavedDatasetCount(storageKey)} 组实验数据。`
      : `云端提交成功，但本机自主探究数据保存失败。请检查浏览器存储设置后重试。`,'ok');
    if(localSaved){
      renderUploadedDatasetList();
      // 为下一种介质准备空白测量表；年级、班级、组别和学生信息保持不变，只清空介质与本次测量值。
      $('#medium').value='';
      $('#note').value='';
      $('#pasteBox').value='';
      clearRows();
      $('#medium').focus();
    }
  }

  function currentStorageKey(){
    const class_name=buildClassName(),group_name=$('#groupName').value.trim();
    const grade=$('#gradeLevel').value.trim(),classNo=$('#classNumber').value.trim();
    if(!class_name||!group_name||!grade||!classNo)return '';
    return 'refraction_self_inquiry_v2_'+encodeURIComponent([grade,classNo,class_name,group_name].join('|'));
  }
  function getSavedDatasetCount(key){
    if(!key)return 0;
    try{return JSON.parse(localStorage.getItem(key)||'[]').length}catch(_){return 0}
  }
  function renderUploadedDatasetList(){
    const key=currentStorageKey(),list=$('#uploadedDatasetList');
    if(!key){
      $('#uploadedDatasetCount').textContent='0 组';
      list.innerHTML='<div class="uploaded-dataset-empty">请先填写年级、班级和组别，系统会显示该小组已上传的实验数据。</div>';
      return;
    }
    let saved=[];try{saved=JSON.parse(localStorage.getItem(key)||'[]')}catch(_){}
    saved=Array.isArray(saved)?saved:[];
    $('#uploadedDatasetCount').textContent=saved.length+' 组';
    list.innerHTML=saved.length?saved.map((x,i)=>`<div class="uploaded-dataset-item"><div><strong>${escapeHtml(x.medium||'未命名介质')}</strong><small>${(x.measurements||[]).length} 个测量点 · ${x.uploaded_at?new Date(x.uploaded_at).toLocaleString('zh-CN'):'已保存'}</small></div><span class="uploaded-tag">✓ 已上传</span></div>`).join(''):'<div class="uploaded-dataset-empty">该小组还没有上传实验数据。填写介质名称并提交后，会显示在这里。</div>';
  }
  function startNextDataset(){
    const key=currentStorageKey();
    if(!key){show('请先填写年级、班级和组别，再添加另一组实验数据。','err');return;}
    const count=getSavedDatasetCount(key);
    if(!count){show('请先完成并成功上传当前第一组实验数据。','err');return;}
    $('#medium').value='';$('#note').value='';$('#pasteBox').value='';clearRows();
    $('#medium').focus();
    show(`已准备添加第 ${count+1} 组实验数据，请填写新的介质名称并录入数据。`,'info');
  }
  $('#addDatasetBtn').addEventListener('click',startNextDataset);
  ['gradeLevel','classNumber','groupName'].forEach(id=>$('#'+id).addEventListener(id==='gradeLevel'?'change':'input',renderUploadedDatasetList));

  $('#gradeLevel').required=true;$('#classNumber').required=true;$('#groupName').required=true;$('#medium').required=true;
  $('#gradeLevel').addEventListener('change',updateClassPreview);
  $('#classNumber').addEventListener('input',updateClassPreview);
  $('#addRowBtn').addEventListener('click',()=>addRow());
  $('#clearRowsBtn').addEventListener('click',clearRows);
  $('#parseBtn').addEventListener('click',parsePaste);
  $('#submitBtn').addEventListener('click',submit);
  clearRows();
  updateClassPreview();
  renderUploadedDatasetList();
  if(!configured) show('当前是未配置状态：教师完成 Supabase 配置后即可在线提交。','info');
})();
