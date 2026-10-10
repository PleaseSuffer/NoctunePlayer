NoctuneScene.define({
    render(api) {
        const sx=api.width/1672,sy=api.height/941;
        api.layer('outside');
        const panes = [[[0, 0], [945, 0], [945, 695], [0, 827]], [[1045, 0], [1400, 0], [1400, 630], [1045, 688]]].map(p=>p.map(([x,y])=>[x*sx,y*sy]));
        api.clip(panes, () => {
            api.flicker([[204,180,34,'#bc88ff'],[206,248,30,'#9aeaff'],[340,292,16,'#ff81bf'],[610,328,30,'#ba8eff'],[830,263,36,'#91ccff'],[886,407,28,'#d68aff'],[1137,318,42,'#88e7ff'],[1240,337,27,'#b58aff'],[1336,276,22,'#ff8bc8'],[1568,362,32,'#ab88ff'],[258,463,34,'#d988ff'],[169,440,32,'#ffd5a4'],[552,452,28,'#f9b996'],[775,427,20,'#9beeff'],[865,493,22,'#ffc498'],[1074,536,24,'#ffcf99'],[1187,528,23,'#ffcda0'],[1438,740,25,'#ffcb98'],[912,576,28,'#b885ff'],[1056,606,25,'#d890ff'],[603,648,28,'#ffcc9f'],[681,768,23,'#ffc497']].map(([x,y,r,...rest])=>[x*sx,y*sy,r*sx,...rest]));
            api.plane({ origin:[0,.888], xAxis:[1,-.248], yAxis:[.07,.84], relative:true }, () => {
                api.line({ x:0, y:0, width:1400*sx, height:65*sy, opacity:.30, fill:.95, adaptiveFill:true, hideWhenSilent:true, count:128, smoothing:.65 });
            });
            api.rain();
        });
        api.layer('inside');
        api.character('character', { anchor: 925*sy, hairY: [0, 430*sy], blink: 'blink', eyes: [[1125*sx, 248*sy, 76*sx, 60*sy], [1238*sx, 183*sy, 67*sx, 65*sy]] });
    },
});
