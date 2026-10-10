(function(){
  var res={title:document.title, url:location.pathname, panels:[], buttons:[], tabs:[], grids:[]};
  document.querySelectorAll('.x-panel-header-text, .x-window-header-text').forEach(function(e){var t=e.textContent.trim(); if(t&&res.panels.indexOf(t)<0)res.panels.push(t);});
  var seen=new Set();
  document.querySelectorAll('.x-toolbar button, .x-toolbar .x-btn, .x-panel:not(.x-hidden) button').forEach(function(b){var t=(b.textContent||'').replace(/\s+/g,' ').trim(); if(t&&!seen.has(t)&&t.length<35){seen.add(t);res.buttons.push(t);}});
  document.querySelectorAll('.x-tab-strip-text, .x-tab').forEach(function(e){var t=e.textContent.trim(); if(t&&t.length<45)res.tabs.push(t);});
  try{
    Ext.ComponentQuery.query('grid').forEach(function(g){
      if(g.hidden)return;
      var st=g.getStore();
      var cols=(g.columns||[]).map(function(c){return ((c.text||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim())+(c.dataIndex?' {'+c.dataIndex+'}':'');}).filter(function(s){return s&&s!=='&nbsp;';});
      var s=null;
      try{if(st.getCount()>0){var d=st.getAt(0).data;var o={};Object.keys(d).forEach(function(k){if(k.indexOf('view')!==0)o[k]=d[k];});s=o;}}catch(e){}
      res.grids.push({cols:cols,count:st.getCount(),first:s});
    });
  }catch(e){res.err=String(e);}
  res.tabs=[...new Set(res.tabs)];
  return JSON.stringify(res);
})()
