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
  const SUBMIT_MAX_ATTEMPTS=3;
  const SUBMIT_TIMEOUT_MS=15000;

  function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
  function errorMessage(err){
    return String(err?.message||err?.error_description||err?.details||err||'未知错误');
  }
  function isNetworkError(err){
    const text=errorMessage(err).toLowerCase();
    return err instanceof TypeError ||
      ['load failed','failed to fetch','networkerror','network request failed','fetch failed',
       'timeout','timed out','connection reset','network is offline','internetdisconnected']
       .some(token=>text.includes(token));
  }
  function withTimeout(promise,ms){
    let timer;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('请求超时')),ms);
    });
    return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
  }
  function newRequestId(){
    if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
      const r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);
    });
  }
  function pendingKeyFor(class_name,group_name,grade_level,class_number){
    return 'refraction_pending_submit_v1_'+encodeURIComponent([grade_level,class_number,class_name,group_name].join('|'));
  }
  function getOrCreatePending(payload){
    const key=pendingKeyFor(payload.class_name,payload.group_name,payload.grade_level,payload.class_number);
    let pending=null;
    try{pending=JSON.parse(localStorage.getItem(key)||'null')}catch(_){}
    const comparable=x=>JSON.stringify({
      class_name:x.class_name,group_name:x.group_name,student_code:x.student_code||null,
      medium:x.medium,note:x.note||null,measurements:x.measurements
    });
    if(pending&&pending.request_id&&comparable(pending.payload||{})===comparable(payload)){
      return {key,request_id:pending.request_id};
    }
    const request_id=newRequestId();
    localStorage.setItem(key,JSON.stringify({request_id,payload,created_at:new Date().toISOString()}));
    return {key,request_id};
  }
  function isIdempotencyDuplicate(err){
    const msg=errorMessage(err).toLowerCase();
    return String(err?.code||'')==='23505' &&
      (String(err?.constraint||'').includes('request_id')||msg.includes('request_id'));
  }
  async function sendSubmission(payload){
    let lastError=null;
    for(let attempt=1;attempt<=SUBMIT_MAX_ATTEMPTS;attempt++){
      if(!navigator.onLine) {
        lastError=new Error('当前设备处于离线状态');
      } else {
        try{
          const result=await withTimeout(
            db.from('submissions').insert(payload),
            SUBMIT_TIMEOUT_MS
          );
          if(!result?.error)return {ok:true};
          if(isIdempotencyDuplicate(result.error))return {ok:true,duplicate:true};
          lastError=result.error;
        }catch(err){lastError=err}
      }
      if(!isNetworkError(lastError)&&!String(lastError?.message||'').includes('超时')&&!String(lastError?.message||'').includes('离线')){
        return {ok:false,error:lastError,network:false};
      }
      if(attempt<SUBMIT_MAX_ATTEMPTS){
        show(`网络连接不稳定，正在安全重试（${attempt}/${SUBMIT_MAX_ATTEMPTS-1}）。请不要关闭页面或修改数据。`,'info');
        await sleep(attempt===1?800:1600);
      }
    }
    return {ok:false,error:lastError,network:true};
  }

  async function submit(){
    if(!db){show('云端连接尚未就绪，请检查网络或稍后重试；当前填写的数据不会清除。','err');return;}
    const grade_level=$('#gradeLevel').value.trim(), class_number=$('#classNumber').value.trim();
    const class_name=buildClassName(), group_name=$('#groupName').value.trim(), student_code=$('#studentCode').value.trim(), medium=$('#medium').value.trim(), note=$('#note').value.trim();
    if(!grade_level){show('请选择年级。','err');$('#gradeLevel').focus();return;}
    if(!class_number||!class_name){show('请填写有效的班级数字（1–99）。','err');$('#classNumber').focus();return;}
    if(!group_name){show('请填写组别。','err');$('#groupName').focus();return;}
    if(!medium){show('请填写本组实验的介质名称，例如：水、玻璃、介质1。','err');$('#medium').focus();return;}
    let measurements;
    try{measurements=collectRows()}catch(e){show(e.message,'err');return}
    if(measurements.length<2){show('请至少录入 2 组有效测量数据。','err');return;}

    const btn=$('#submitBtn'),originalText=btn.textContent;
    btn.disabled=true;btn.textContent='正在连接云端…';
    let pending;
    const payload={
      class_name,group_name,student_code:student_code||null,
      medium,note:note||null,measurements
    };
    try{
      pending=getOrCreatePending({grade_level,class_number,...payload});
    }catch(storageErr){
      btn.disabled=false;btn.textContent=originalText;
      show('浏览器无法保存本次提交编号。请检查网站存储权限后再提交，避免网络异常时产生重复记录。','err');
      return;
    }
    const requestPayload={...payload,request_id:pending.request_id};
    show('正在提交数据，请稍候…','info');
    const result=await sendSubmission(requestPayload);
    if(!result.ok){
      btn.disabled=false;btn.textContent=originalText;
      if(result.network){
        show('暂时无法确认云端是否收到数据。你填写的数据已保留；请保持内容不变，再点击提交，系统会沿用同一个提交编号，避免重复入库。','err');
      }else if(String(result.error?.code||'')==='42703'||errorMessage(result.error).toLowerCase().includes('request_id')){
        show('数据库尚未完成安全提交升级。请管理员先在 Supabase SQL Editor 执行本次更新包中的“supabase_idempotency_migration.sql”，再重新提交。当前数据已保留。','err');
      }else{
        show(`提交失败：${errorMessage(result.error)}。已保留填写内容，请检查后重试。`,'err');
      }
      console.warn('Student submission failed:',result.error);
      return;
    }

    // 云端确认成功（或相同 request_id 已存在）后，才将记录写入自主探究本地副本。
    let localSaved=true,storageKey='';
    try{
      const localIdentity=[grade_level,class_number,class_name,group_name].join('|');
      storageKey='refraction_self_inquiry_v2_'+encodeURIComponent(localIdentity);
      let saved=[];
      try{saved=JSON.parse(localStorage.getItem(storageKey)||'[]')}catch(_){saved=[]}
      const record={
        grade_level,class_number,class_name,group_name,student_code:student_code||'',
        medium,note,measurements:measurements.map(p=>({i:p.i,r:p.r})),
        uploaded_at:new Date().toISOString(),request_id:pending.request_id
      };
      // request_id 本地去重：同一请求重试成功时不会在自主探究记录中重复出现。
      if(!saved.some(x=>x.request_id===pending.request_id))saved.push(record);
      saved=saved.slice(-30);
      localStorage.setItem(storageKey,JSON.stringify(saved));
      localStorage.removeItem(storageKey+'_inquiry_progress');
      localStorage.setItem('refraction_self_inquiry_last_key',storageKey);
      localStorage.setItem('refraction_self_inquiry_identity',JSON.stringify({grade_level,class_number,class_name,group_name}));
      localStorage.removeItem(pending.key);
    }catch(storageError){
      localSaved=false;
      console.warn('Local inquiry cache save failed:',storageError);
    }

    btn.disabled=false;btn.textContent=originalText;
    show(localSaved
      ? `提交成功：${measurements.length} 个测量点，介质“${medium}”已保存；本组目前共有 ${getSavedDatasetCount(storageKey)} 组实验数据。`
      : '云端已确认提交成功，但本机自主探究缓存保存失败。请勿重复提交；可检查浏览器存储权限。','ok');
    if(localSaved){
      renderUploadedDatasetList();
      $('#medium').value='';$('#note').value='';$('#pasteBox').value='';
      clearRows();$('#medium').focus();
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
  window.addEventListener('offline',()=>show('当前设备网络已断开。已填写的数据会保留，恢复网络后可以重新提交。','err'));
  window.addEventListener('online',()=>show('网络已恢复，可以继续提交实验数据。','ok'));
  clearRows();
  updateClassPreview();
  renderUploadedDatasetList();
  if(!configured) show('当前是未配置状态：教师完成 Supabase 配置后即可在线提交。','info');
})();
