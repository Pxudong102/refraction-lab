(() => {
  const $=s=>document.querySelector(s), cfg=window.APP_CONFIG||{};
  const configured=cfg.supabaseUrl&&cfg.supabaseAnonKey&&!cfg.supabaseUrl.includes('YOUR_')&&!cfg.supabaseAnonKey.includes('YOUR_');
  const db=configured?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
  let all=[];
  const loginStatus=$('#loginStatus'), dashStatus=$('#dashStatus');

  function show(el,msg,type='info'){el.textContent=msg;el.className=`status show ${type}`}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

  function normalizeClassName(v){
    let t=String(v??'').trim().replace(/\s+/g,'').replace(/[０-９]/g,d=>String(d.charCodeAt(0)-65248));
    const m=t.match(/^高([一二三123])[（(]?([0-9]{1,2})[）)]?班?$/);
    if(!m)return t;
    const gradeMap={'1':'一','2':'二','3':'三','一':'一','二':'二','三':'三'};
    return `高${gradeMap[m[1]]}（${Number(m[2])}）班`;
  }

  function filtered(){
    const c=$('#filterClass').value.trim().toLowerCase(),g=$('#filterGroup').value.trim().toLowerCase(),m=$('#filterMedium').value.trim().toLowerCase();
    return all.filter(x=>{
      const cls=normalizeClassName(x.class_name).toLowerCase();
      return(!c||cls.includes(c)||String(x.class_name||'').toLowerCase().includes(c))&&(!g||String(x.group_name||'').toLowerCase().includes(g))&&(!m||String(x.medium||'').toLowerCase().includes(m));
    });
  }

  function render(){
    const rows=filtered(), body=$('#teacherBody'); body.innerHTML='';
    let pts=0; const groups=new Set(), classes=new Set();
    for(const x of rows){
      pts+=(x.measurements||[]).length;
      const cls=normalizeClassName(x.class_name);
      groups.add(`${cls}|${x.group_name}`);classes.add(cls);
      const tr=document.createElement('tr');
      const pairs=(x.measurements||[]).map(p=>`${p.i}°, ${p.r}°`).join('<br>');
      tr.innerHTML=`<td>${new Date(x.created_at).toLocaleString('zh-CN')}</td><td>${esc(cls)}</td><td>${esc(x.group_name)}</td><td>${esc(x.student_code||'—')}</td><td>${esc(x.medium||'—')}</td><td class="measurements">${pairs}</td><td>${esc(x.note||'—')}</td><td><button class="btn danger del" data-id="${x.id}" style="height:30px">删除</button></td>`;
      body.appendChild(tr);
    }
    $('#submissionCount').textContent=rows.length;$('#groupCount').textContent=groups.size;$('#pointCount').textContent=pts;$('#classCount').textContent=classes.size;
    body.querySelectorAll('.del').forEach(b=>b.addEventListener('click',()=>removeOne(b.dataset.id)));
  }

  async function load(){
    const {data,error}=await db.from('submissions').select('*').order('created_at',{ascending:false});
    if(error){show(dashStatus,`读取失败：${friendlyError(error,'读取数据')}`,'err');return}
    all=data||[];render();
  }

  function errorText(error){
    return String(error?.message||error?.error_description||error?.code||error||'').trim();
  }

  function isCredentialError(error){
    const code=String(error?.code||'').toLowerCase();
    const msg=errorText(error).toLowerCase();
    return code==='invalid_credentials'||msg.includes('invalid login credentials')||msg.includes('invalid_credentials');
  }

  function isEmailNotConfirmed(error){
    const code=String(error?.code||'').toLowerCase();
    const msg=errorText(error).toLowerCase();
    return code==='email_not_confirmed'||msg.includes('email not confirmed');
  }

  function isNetworkError(error){
    const code=String(error?.code||'').toLowerCase();
    const msg=errorText(error).toLowerCase();
    return code.includes('fetch')||code.includes('network')||code.includes('retryable')||
      msg.includes('load failed')||msg.includes('failed to fetch')||msg.includes('network request failed')||
      msg.includes('networkerror')||msg.includes('fetch failed')||msg.includes('connection')||msg.includes('timeout');
  }

  function friendlyError(error,action='操作'){
    if(isCredentialError(error))return '账号或密码错误';
    if(isEmailNotConfirmed(error))return '该教师邮箱尚未完成确认';
    if(isNetworkError(error))return `网络连接异常，${action}请求未能到达服务器`;
    return errorText(error)||`${action}失败`;
  }

  async function login(){
    if(!configured){show(loginStatus,'请先配置 config.js。','err');return}
    const email=$('#email').value.trim(),password=$('#password').value;
    const btn=$('#loginBtn');
    if(!email||!password){show(loginStatus,'请输入教师邮箱和密码。','err');return}

    const originalText=btn.textContent;
    btn.disabled=true;
    let finalError=null;

    try{
      for(let attempt=0;attempt<3;attempt++){
        btn.textContent=attempt===0?'连接中…':`重试中 ${attempt}/2…`;
        if(attempt===0)show(loginStatus,'正在连接教师服务器…','info');
        else show(loginStatus,`网络连接不稳定，正在自动重试（${attempt}/2）…`,'info');

        let result;
        try{
          result=await db.auth.signInWithPassword({email,password});
        }catch(err){
          result={error:err};
        }

        const error=result?.error||null;
        if(!error){
          show(loginStatus,'登录成功，正在读取实验数据…','ok');
          await syncAuth();
          return;
        }

        finalError=error;
        if(isCredentialError(error)){
          show(loginStatus,'账号或密码错误，请检查后重新输入。','err');
          return;
        }
        if(isEmailNotConfirmed(error)){
          show(loginStatus,'该教师邮箱尚未完成确认，请先确认邮箱。','err');
          return;
        }
        if(!isNetworkError(error)){
          show(loginStatus,`登录失败：${friendlyError(error,'登录')}`,'err');
          return;
        }
        if(attempt<2)await sleep(attempt===0?700:1200);
      }

      show(loginStatus,'暂时无法连接 Supabase。请刷新页面或切换网络后再登录；账号和密码本身不一定有问题。','err');
      console.warn('Teacher login network failure after retries:',finalError);
    }finally{
      btn.disabled=false;
      btn.textContent=originalText;
    }
  }

  async function logout(){await db.auth.signOut();await syncAuth()}

  async function syncAuth(){
    if(!configured){show(loginStatus,'当前未连接 Supabase。','err');return}
    const {data:{session}}=await db.auth.getSession();
    const on=!!session;
    $('#loginCard').style.display=on?'none':'block';
    $('#dashboard').style.display=on?'block':'none';
    $('#logoutBtn').style.display=on?'inline-flex':'none';
    if(on)await load();
  }

  async function removeOne(id){
    if(!confirm('确定删除这次提交吗？'))return;
    const {error}=await db.from('submissions').delete().eq('id',id);
    if(error){show(dashStatus,`删除失败：${friendlyError(error,'删除')}`,'err');return}
    all=all.filter(x=>x.id!==id);render();show(dashStatus,'已删除。','ok');
  }

  function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
  function download(name,lines){const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function safeFilePart(v){return String(v||'').trim().replace(/[\/:*?"<>|]/g,'-').replace(/\s+/g,'').slice(0,50)||'未命名班级'}
  function classFilePrefix(rows){const classes=[...new Set(rows.map(x=>normalizeClassName(x.class_name)).filter(Boolean))];if(classes.length===1)return safeFilePart(classes[0]);const typed=$('#filterClass').value.trim();if(typed)return safeFilePart(normalizeClassName(typed));return classes.length>1?'多班级':'未命名班级'}
  function analysisCsv(){const rows=filtered();if(!rows.length){show(dashStatus,'当前筛选条件下没有可下载的数据。','err');return}const lines=['数据组,入射角i(°),折射角r(°)'];for(const x of rows){const group=x.group_name||'未命名组';for(const p of x.measurements||[])lines.push([group,p.i,p.r].map(csvCell).join(','))}download(`${classFilePrefix(rows)}_光的折射分析数据.csv`,lines)}
  function detailCsv(){const rows=filtered();if(!rows.length){show(dashStatus,'当前筛选条件下没有可下载的数据。','err');return}const lines=['提交ID,提交时间,班级,组别,学生,介质,备注,入射角i(°),折射角r(°)'];for(const x of rows){for(const p of x.measurements||[])lines.push([x.id,x.created_at,normalizeClassName(x.class_name),x.group_name,x.student_code||'',x.medium||'',x.note||'',p.i,p.r].map(csvCell).join(','))}download(`${classFilePrefix(rows)}_光的折射详细数据.csv`,lines)}

  $('#loginBtn').addEventListener('click',login);
  $('#password').addEventListener('keydown',e=>{if(e.key==='Enter'&&!$('#loginBtn').disabled)login()});
  $('#logoutBtn').addEventListener('click',logout);
  $('#refreshBtn').addEventListener('click',load);
  $('#analysisCsvBtn').addEventListener('click',analysisCsv);
  $('#detailCsvBtn').addEventListener('click',detailCsv);
  ['filterClass','filterGroup','filterMedium'].forEach(id=>$('#'+id).addEventListener('input',render));
  if(configured) db.auth.onAuthStateChange(()=>syncAuth());
  syncAuth();
})();
