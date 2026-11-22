const assert=require('node:assert/strict');
const create=require('../../src/renderer/addons/interface');
const nodes=[],listeners=new Map();
class Node{
 constructor(tag){this.tag=tag;this.dataset={};this.children=[];this.attrs={};nodes.push(this);}
 append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
 setAttribute(k,v){this.attrs[k]=v;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.removed=true;}
}
const cards=['first','second'].map(id=>{const n=new Node('card');n.dataset.addonId=id;return n;});
const toasts=['first:sync','second:sync'].map(key=>{const n=new Node('toast');n.dataset.replaceKey=key;return n;});
const document={createElement:t=>new Node(t),addEventListener:(n,cb)=>listeners.set(n,cb),querySelectorAll:s=>s.includes('notification-stack')?toasts.filter(n=>!n.removed):s==='[data-addon-elements]'?nodes.filter(n=>n.dataset.addonElements&&!n.removed):cards};
const api=create(document),grants=new Set(['ui.elements','notifications.dismiss']);
const call=(owner,method,args,rights=grants)=>api.invoke(owner,method,args,rights);
assert.throws(()=>call('first','ui.set',{id:'status',label:'Label',value:'Value'},new Set()));
call('first','ui.set',{id:'status',label:'<script>',value:'<img onerror=bad>',progress:0.5});
assert.equal(cards[0].children[0].children[0].children[1].textContent,'<img onerror=bad>');
assert.equal(cards[0].children[0].children[0].children[2].value,0.5);
call('second','ui.set',{id:'status',label:'Other',value:'Safe'});
assert.throws(()=>call('first','ui.set',{id:'status',label:'X',value:'X',progress:NaN}));
for(let i=0;i<7;i++)call('first','ui.set',{id:'item-'+i,label:'X',value:'Y'});
assert.throws(()=>call('first','ui.set',{id:'ninth',label:'X',value:'Y'}));
assert.equal(call('first','ui.remove',{id:'status'}),true);
assert.equal(cards[1].children[0].children[0].children[1].textContent,'Safe');
listeners.get('addon-integrations-rendered')();assert.equal(cards[1].children.length,1,'rerender does not duplicate elements');
assert.throws(()=>call('first','notifications.dismiss',{key:'sync'},new Set()));
assert.equal(call('first','notifications.dismiss',{key:'sync'}),true);assert(!toasts[1].removed);
api.cleanup('first');assert.equal(cards[0].children.length,0);assert.equal(cards[1].children.length,1);
api.cleanup('second');assert(toasts[1].removed);
console.log('PASS: interface permissions, safe text, owner isolation, progress bounds, quotas, rerender, keyed notification dismissal and cleanup.');
