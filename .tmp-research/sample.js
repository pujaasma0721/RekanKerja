(function(){
  try{
    var gs=Ext.ComponentQuery.query('grid');var out=[];
    gs.forEach(function(g){
      if(g.hidden)return;
      var st=g.getStore();var rows=[];
      try{var n=Math.min(2,st.getCount());for(var i=0;i<n;i++){var d=st.getAt(i).data;var f={};for(var k in d){if(k.indexOf('view')===0)continue;f[k]=d[k];}rows.push(f);}}catch(e){}
      if(rows.length)out.push(rows);
    });
    return JSON.stringify(out).slice(0,2200);
  }catch(e){return 'ERR '+e;}
})()
