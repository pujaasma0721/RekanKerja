(function(){
  var res = {panels:[], grids:[], buttons:[], tabs:[]};
  document.querySelectorAll('.x-panel-header-text, .x-window-header-text').forEach(function(e){var t=e.textContent.trim(); if(t) res.panels.push(t);});
  var seen=new Set();
  document.querySelectorAll('button, .x-btn').forEach(function(b){var t=(b.textContent||'').replace(/\s+/g,' ').trim(); if(t && !seen.has(t) && t.length<35){seen.add(t); res.buttons.push(t);}});
  document.querySelectorAll('.x-tab-strip-text, .x-tab').forEach(function(e){var t=e.textContent.trim(); if(t && t.length<40) res.tabs.push(t);});
  try{
    Ext.ComponentQuery.query('grid').forEach(function(g){
      var st=g.getStore();
      var cols=(g.columns||[]).map(function(c){return (c.text||'').replace(/\s+/g,' ').trim() + (c.dataIndex? '->'+c.dataIndex : '');}).filter(function(s){return s && s!=='-';});
      var sample=[];
      try{ var n=Math.min(3, st.getCount()); for(var i=0;i<n;i++){ sample.push(st.getAt(i).data); } }catch(e){}
      res.grids.push({id:g.id, title:g.title||'', cols:cols, count:st.getCount(), total:(st.getTotalCount?st.getTotalCount():null), sample:sample});
    });
  }catch(e){ res.err=String(e); }
  return JSON.stringify(res);
})()
