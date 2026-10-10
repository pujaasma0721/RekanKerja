(function(){
  var out=[];
  try{
    Ext.ComponentQuery.query('treepanel').forEach(function(tp){
      try{ tp.expandAll(); }catch(e){}
    });
  }catch(e){}
  try{
    Ext.ComponentQuery.query('treepanel').forEach(function(tp){
      var root = tp.getRootNode();
      var walk = function(n, d){
        var t=(n.get('text')||'').replace(/\s+/g,' ').trim();
        if(t) out.push({d:d, t:t, leaf:!!n.get('leaf'), cid:(n.get('componentCls')||'')});
        n.eachChild(function(c){walk(c,d+1);});
      };
      walk(root,0);
    });
  }catch(e){out.push({err:String(e)});}
  return JSON.stringify(out);
})()
