(function(){
  var out=[];
  try{
    Ext.ComponentQuery.query('treepanel').forEach(function(tp){
      var root = tp.getRootNode();
      var walk = function(n){
        var t=(n.get('text')||'').replace(/\s+/g,' ').trim();
        if(/Job Opportunit|Selection Process to be|Personnel Requi|Recruitment Plan/.test(t)){
          var attrs={};
          var raw=n.data||n.attributes||{};
          for(var k in raw){ if(typeof raw[k]==='string'||typeof raw[k]==='number'||typeof raw[k]==='boolean'){ attrs[k]=raw[k]; } }
          out.push({text:reStrip(t), attrs:attrs});
        }
        n.eachChild(function(c){walk(c);});
      };
      var reStrip=function(s){return s.replace(/<[^>]+>/g,'');};
      walk(root);
    });
  }catch(e){out.push({err:String(e)});}
  return JSON.stringify(out).slice(0,15000);
})()
