(() => {
  const $ = s => document.querySelector(s);
  const cfg = window.APP_CONFIG || {};
  const status = $('#status');
  const configured = cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR_') && !cfg.supabaseAnonKey.includes('YOUR_');
  const db = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  function show(msg, type='info') { status.textContent = msg; status.className = `status show ${type}`; }
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
    if(!configured){show('网站尚未连接 Supabase，请教师先完成 config.js 配置。','err');return;}
    const class_name=$('#className').value.trim(), group_name=$('#groupName').value.trim(), student_code=$('#studentCode').value.trim(), medium=$('#medium').value.trim(), note=$('#note').value.trim();
    if(!class_name||!group_name){show('请填写班级和组别。','err');return;}
    let measurements; try{measurements=collectRows();}catch(e){show(e.message,'err');return;}
    if(measurements.length<2){show('请至少录入 2 组有效测量数据。','err');return;}
    const btn=$('#submitBtn'); btn.disabled=true; btn.textContent='正在提交…';
    const {error}=await db.from('submissions').insert({class_name,group_name,student_code:student_code||null,medium:medium||null,note:note||null,measurements});
    btn.disabled=false; btn.textContent='提交本组实验数据';
    if(error){show(`提交失败：${error.message}`,'err');return;}
    show(`提交成功：${measurements.length} 个数据点。可以关闭页面或继续修改后再次提交。`,'ok');
  }
  $('#addRowBtn').addEventListener('click',()=>addRow());
  $('#clearRowsBtn').addEventListener('click',clearRows);
  $('#parseBtn').addEventListener('click',parsePaste);
  $('#submitBtn').addEventListener('click',submit);
  clearRows();
  if(!configured) show('当前是未配置状态：教师完成 Supabase 配置后即可在线提交。','info');
})();
