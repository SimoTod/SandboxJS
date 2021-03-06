class Prop {
    constructor(context, prop, isConst = false, isGlobal = false) {
        this.context = context;
        this.prop = prop;
        this.isConst = isConst;
        this.isGlobal = isGlobal;
    }
}
class Lisp {
    constructor(obj) {
        this.op = obj.op;
        this.a = obj.a;
        this.b = obj.b;
    }
}
class If {
    constructor(t, f) {
        this.t = t;
        this.f = f;
    }
}
class KeyVal {
    constructor(key, val) {
        this.key = key;
        this.val = val;
    }
}
class ObjectFunc {
    constructor(key, args, tree) {
        this.key = key;
        this.args = args;
        this.tree = tree;
    }
}
class SpreadObject {
    constructor(item) {
        this.item = item;
    }
}
class SpreadArray {
    constructor(item) {
        this.item = item;
    }
}
class Scope {
    constructor(parent, vars = {}, functionThis = undefined) {
        this.const = {};
        this.var = {};
        this.globals = {};
        this.parent = parent;
        this.let = !parent ? {} : vars;
        this.globals = !parent ? vars : {};
        this.functionThis = functionThis || !parent;
        if (functionThis) {
            this.declare('this', 'var', functionThis);
        }
    }
    get(key, functionScope = false) {
        if (!this.parent || !functionScope || this.functionThis) {
            if (key in this.const) {
                return new Prop(this.const, key, true, key in this.globals);
            }
            if (key in this.var) {
                return new Prop(this.var, key, false, key in this.globals);
            }
            if (key in this.let) {
                return new Prop(this.let, key, false, key in this.globals);
            }
            if (!this.parent && key in this.globals) {
                return new Prop(this.functionThis, key, false, true);
            }
            if (!this.parent) {
                return new Prop(undefined, key);
            }
        }
        return this.parent.get(key, functionScope);
    }
    set(key, val) {
        if (key === 'this')
            throw new Error('"this" cannot be a variable');
        let prop = this.get(key);
        if (prop.context === undefined) {
            throw new Error(`Variable '${key}' was not declared.`);
        }
        if (prop.isConst) {
            throw Error(`Cannot assign to const variable '${key}'`);
        }
        if (prop.isGlobal) {
            throw Error(`Cannot override global variable '${key}'`);
        }
        prop.context[prop] = val;
        return prop;
    }
    declare(key, type = null, value = undefined, isGlobal = false) {
        if (type === 'var' && !this.functionThis && this.parent) {
            this.parent.declare(key, type, value, isGlobal);
        }
        else if (!(key in this.var) || !(key in this.let) || !(key in this.const) || !(key in this.globals)) {
            if (isGlobal) {
                this.globals[key] = value;
            }
            this[type][key] = value;
        }
        else {
            throw Error(`Variable '${key}' already declared`);
        }
    }
}
class SandboxGlobal {
    constructor(globals) {
        if (globals === globalThis)
            return globalThis;
        for (let i in globals) {
            this[i] = globals[i];
        }
    }
}
function sandboxFunction(context) {
    return SandboxFunction;
    function SandboxFunction(...params) {
        let code = params.pop();
        let parsed = Sandbox.parse(code);
        return function (...args) {
            const vars = {};
            for (let i of params) {
                vars[i] = args.shift();
            }
            const res = context.sandbox.executeTree(parsed);
            if (context.options.audit) {
                for (let key in res.auditReport.globalsAccess) {
                    let add = res.auditReport.globalsAccess[key];
                    context.auditReport.globalsAccess[key] = context.auditReport.globalsAccess[key] || new Set();
                    add.forEach((val) => {
                        context.auditReport.globalsAccess[key].add(val);
                    });
                }
                for (let Class in res.auditReport.prototypeAccess) {
                    let add = res.auditReport.prototypeAccess[Class];
                    context.auditReport.prototypeAccess[Class] = context.auditReport.prototypeAccess[Class] || new Set();
                    add.forEach((val) => {
                        context.auditReport.prototypeAccess[Class].add(val);
                    });
                }
            }
            return res.result;
        };
    }
}
function sandboxedEval(func) {
    return sandboxEval;
    function sandboxEval(code) {
        return func(code)();
    }
}
let expectTypes = {
    op: {
        types: { op: /^(\/|\*\*(?!\=)|\*(?!\=)|\%(?!\=))/ },
        next: [
            'value',
            'prop',
            'exp',
            'modifier',
            'incrementerBefore',
        ]
    },
    splitter: {
        types: {
            split: /^(&&|&|\|\||\||<=|>=|<|>|!==|!=|===|==|#instanceof#|#in#|\+(?!\+)|\-(?!\-))(?!\=)/,
        },
        next: [
            'value',
            'prop',
            'exp',
            'modifier',
            'incrementerBefore',
        ]
    },
    if: {
        types: {
            if: /^\?/,
            else: /^:/,
        },
        next: [
            'expEnd'
        ]
    },
    assignment: {
        types: {
            assignModify: /^(\-=|\+=|\/=|\*\*=|\*=|%=|\^=|\&=|\|=)/,
            assign: /^(=)/
        },
        next: [
            'value',
            'prop',
            'function',
            'exp',
            'modifier',
            'incrementerBefore',
        ]
    },
    incrementerBefore: {
        types: { incrementerBefore: /^(\+\+|\-\-)/ },
        next: [
            'prop',
        ]
    },
    incrementerAfter: {
        types: { incrementerAfter: /^(\+\+|\-\-)/ },
        next: [
            'splitter',
            'op',
            'expEnd'
        ]
    },
    expEdge: {
        types: {
            arrayProp: /^[\[]/,
            call: /^[\(]/,
        },
        next: [
            'splitter',
            'op',
            'expEdge',
            'if',
            'dot',
            'expEnd'
        ]
    },
    modifier: {
        types: {
            not: /^!/,
            inverse: /^~/,
            negative: /^\-(?!\-)/,
            positive: /^\+(?!\+)/,
            typeof: /^#typeof#/,
        },
        next: [
            'exp',
            'modifier',
            'value',
            'prop',
            'incrementerBefore',
        ]
    },
    exp: {
        types: {
            createObject: /^\{/,
            createArray: /^\[/,
            group: /^\(/,
        },
        next: [
            'splitter',
            'op',
            'expEdge',
            'if',
            'dot',
            'expEnd'
        ]
    },
    dot: {
        types: {
            dot: /^\.(?!\.)/
        },
        next: [
            'splitter',
            'incrementerAfter',
            'assignment',
            'op',
            'expEdge',
            'if',
            'dot',
            'expEnd'
        ]
    },
    prop: {
        types: {
            prop: /^[a-zA-Z\$_][a-zA-Z\d\$_]*/,
        },
        next: [
            'splitter',
            'incrementerAfter',
            'assignment',
            'op',
            'expEdge',
            'if',
            'dot',
            'expEnd'
        ]
    },
    value: {
        types: {
            number: /^\-?\d+(\.\d+)?/,
            string: /^"(\d+)"/,
            literal: /^`(\d+)`/,
            boolean: /^(true|false)(?![\w$_])/,
            null: /^null(?![\w$_])/,
            und: /^undefined(?![\w$_])/,
            NaN: /^NaN(?![\w$_])/,
            Infinity: /^Infinity(?![\w$_])/,
        },
        next: [
            'splitter',
            'op',
            'if',
            'dot',
            'expEnd'
        ]
    },
    function: {
        types: {
            arrowFunc: /^\(?([a-zA-Z\$_][a-zA-Z\d\$_]*,?)*(\))?=>({)?/
        },
        next: [
            'expEnd'
        ]
    },
    initialize: {
        types: {
            initialize: /^#(var|let|const)#[a-zA-Z\$_][a-zA-Z\d\$_]*/
        },
        next: [
            'value',
            'prop',
            'function',
            'exp',
            'modifier',
            'incrementerBefore',
            'expEnd'
        ]
    },
    spreadObject: {
        types: {
            spreadObject: /^\.\.\./
        },
        next: [
            'value',
            'exp',
            'prop',
        ]
    },
    spreadArray: {
        types: {
            spreadArray: /^\.\.\./
        },
        next: [
            'value',
            'exp',
            'prop',
        ]
    },
    expEnd: { types: {}, next: [] },
    expStart: {
        types: {
            return: /^#return#/,
        },
        next: [
            'value',
            'prop',
            'exp',
            'modifier',
            'incrementerBefore',
            'expEnd'
        ]
    }
};
let closings = {
    "(": ")",
    "[": "]",
    "{": "}",
    "'": "'",
    '"': '"',
    "`": "`"
};
const restOfExp = (part, tests, quote) => {
    let okFirstChars = /^[\+\-~#!]/;
    let isStart = true;
    tests = tests || [
        expectTypes.op.types.op,
        expectTypes.splitter.types.split,
        expectTypes.if.types.if,
        expectTypes.if.types.else
    ];
    let escape = false;
    let done = false;
    let i;
    for (i = 0; i < part.length && !done; i++) {
        let char = part[i];
        if (quote === '"' || quote === "'" || quote === "`") {
            if (quote === "`" && char === "$" && part[i + 1] === "{" && !escape) {
                let skip = restOfExp(part.substring(i + 2), [/^}/]);
                i += skip.length + 2;
            }
            else if (char === quote && !escape) {
                return part.substring(0, i);
            }
            escape = char === "\\";
        }
        else if (closings[char]) {
            let skip = restOfExp(part.substring(i + 1), [new RegExp('^\\' + closings[quote])], char);
            i += skip.length + 1;
            isStart = false;
        }
        else if (!quote) {
            let sub = part.substring(i);
            tests.forEach((test) => {
                done = done || test.test(sub);
            });
            if (isStart) {
                if (okFirstChars.test(sub)) {
                    done = false;
                }
                else {
                    isStart = false;
                }
            }
            if (done)
                break;
        }
        else if (char === closings[quote]) {
            return part.substring(0, i);
        }
    }
    return part.substring(0, i);
};
restOfExp.next = [
    'splitter',
    'op',
    'expEnd'
];
function assignCheck(obj) {
    if (obj.context === undefined) {
        throw new Error(`Cannot assign value to undefined.`);
    }
    if (obj.isConst) {
        throw new Error(`Cannot set value to const variable '${obj.prop}'`);
    }
    if (obj.isGlobal) {
        throw Error(`Cannot override property of global variable '${obj.prop}'`);
    }
    if (!obj.context.hasOwnProperty(obj.prop) && obj.prop in obj.context) {
        throw Error(`Cannot override prototype property '${obj.prop}'`);
    }
}
let ops2 = {
    'prop': (a, b, obj, context, scope) => {
        if (typeof a === 'undefined') {
            let prop = scope.get(b);
            if (prop.context === undefined)
                throw new Error(`${b} is not defined`);
            if (prop.context === context.sandboxGlobal) {
                if (context.options.audit) {
                    context.auditReport.globalsAccess.add(b);
                }
                if (context.sandboxGlobal[b] === Function) {
                    return context.Function;
                }
                if (context.sandboxGlobal[b] === eval) {
                    return context.eval;
                }
                const fn = context.sandboxGlobal[b];
                if (setTimeout === fn || fn === setInterval) {
                    return undefined;
                }
            }
            if (prop.context && prop.context[b] === globalThis) {
                return context.globalScope.get('this');
            }
            return prop;
        }
        let ok = false;
        if (a === null) {
            throw new Error('Cannot get propety of null');
        }
        if (typeof a === 'number') {
            a = new Number(a);
        }
        if (typeof a === 'string') {
            a = new String(a);
        }
        if (typeof a === 'boolean') {
            a = new Boolean(a);
        }
        ok = a.hasOwnProperty(b) || parseInt(b, 10) + "" === b + "";
        if (!ok && context.options.audit) {
            ok = true;
            if (typeof b === 'string') {
                if (!context.auditReport.prototypeAccess[a.constructor.name]) {
                    context.auditReport.prototypeAccess[a.constructor.name] = new Set();
                }
                context.auditReport.prototypeAccess[a.constructor.name].add(b);
            }
        }
        if (!ok && context.prototypeWhitelist.has(a.constructor)) {
            let whitelist = (context.prototypeWhitelist.get(a.constructor) || []);
            ok = !whitelist.length || whitelist.includes(b);
        }
        else if (!ok) {
            context.prototypeWhitelist.forEach((allowedProps, Class) => {
                if (!ok && a instanceof Class) {
                    ok = ok || (a[b] === Class.prototype[b]);
                    ok = ok && (!allowedProps || !allowedProps.length || allowedProps.includes(b));
                }
            });
        }
        if (ok) {
            if (a[b] === Function) {
                return context.Function;
            }
            if (a[b] === globalThis) {
                return context.globalScope.get('this');
            }
            let g = obj.isGlobal || a.constructor === Function;
            return new Prop(a, b, false, g);
        }
        throw Error(`Method or property access prevented: ${a.constructor.name}.${b}`);
    },
    'call': (a, b, obj, context, scope) => {
        if (context.options.forbidMethodCalls)
            throw new Error("Method calls are not allowed");
        if (typeof a !== 'function') {
            throw new Error(`${obj.prop} is not a function`);
        }
        if (typeof obj === 'function') {
            return obj(...b.map((item) => exec(item, scope, context)));
        }
        return obj.context[obj.prop](...b.map((item) => exec(item, scope, context)));
    },
    'createObject': (a, b, obj, context, scope) => {
        let res = {};
        for (let item of b) {
            if (item instanceof SpreadObject) {
                res = { ...res, ...item.item };
            }
            else if (item instanceof ObjectFunc) {
                let f = item;
                res[f.key] = function (...args) {
                    const vars = {};
                    (f.args).forEach((arg, i) => {
                        vars[arg] = args[i];
                    });
                    return context.sandbox.executeTree({
                        tree: f.tree,
                        strings: context.strings,
                        literals: context.literals,
                    }, [new Scope(scope, vars, this)]).result;
                };
            }
            else {
                res[item.key] = item.val;
            }
        }
        return res;
    },
    'keyVal': (a, b) => new KeyVal(a, b),
    'createArray': (a, b, obj, context, scope) => {
        let arrs = [];
        let curr = [];
        b.forEach((item) => {
            if (item instanceof SpreadArray) {
                if (curr.length) {
                    arrs.push(curr);
                    curr = [];
                }
                arrs.push(item.item);
            }
            else {
                curr.push(exec(item, scope, context));
            }
        });
        if (curr.length)
            arrs.push(curr);
        return arrs.flat();
    },
    'group': (a, b) => b,
    'string': (a, b, obj, context) => context.strings[b],
    'literal': (a, b, obj, context, scope) => {
        let name = context.literals[b].a;
        return name.replace(/(\$\$)*(\$)?\${(\d+)}/g, (match, $$, $, num) => {
            if ($)
                return match;
            let res = exec(context.literals[b].b[parseInt(num, 10)], scope, context);
            res = res instanceof Prop ? res.context[res.prop] : res;
            return ($$ ? $$ : '') + `${res}`.replace(/\$/g, '$$');
        }).replace(/\$\$/g, '$');
    },
    'spreadArray': (a, b, obj, context, scope) => {
        return new SpreadArray(exec(b, scope, context));
    },
    'spreadObject': (a, b, obj, context, scope) => {
        return new SpreadObject(exec(b, scope, context));
    },
    '!': (a, b) => !b,
    '~': (a, b) => ~b,
    '++$': (a, b, obj) => ++obj.context[obj.prop],
    '$++': (a, b, obj) => obj.context[obj.prop]++,
    '--$': (a, b, obj) => --obj.context[obj.prop],
    '$--': (a, b, obj) => obj.context[obj.prop]--,
    '=': (a, b, obj, context, scope, bobj) => {
        assignCheck(obj);
        obj.context[obj.prop] = b;
        return new Prop(obj.context, obj.prop, false, obj.isGlobal);
    },
    '+=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] += b;
    },
    '-=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] -= b;
    },
    '/=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] /= b;
    },
    '*=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] *= b;
    },
    '**=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] **= b;
    },
    '%=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] %= b;
    },
    '^=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] ^= b;
    },
    '&=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] &= b;
    },
    '|=': (a, b, obj) => {
        assignCheck(obj);
        return obj.context[obj.prop] |= b;
    },
    '?': (a, b) => {
        if (!(b instanceof If)) {
            throw new Error('Invalid inline if');
        }
        return a ? b.t : b.f;
    },
    '>': (a, b) => a > b,
    '<': (a, b) => a < b,
    '>=': (a, b) => a >= b,
    '<=': (a, b) => a <= b,
    '==': (a, b) => a == b,
    '===': (a, b) => a === b,
    '!=': (a, b) => a != b,
    '!==': (a, b) => a !== b,
    '&&': (a, b) => a && b,
    '||': (a, b) => a || b,
    '&': (a, b) => a & b,
    '|': (a, b) => a | b,
    ':': (a, b) => new If(a, b),
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '$+': (a, b) => +b,
    '$-': (a, b) => -b,
    '/': (a, b) => a / b,
    '*': (a, b) => a * b,
    '%': (a, b) => a % b,
    '#typeof#': (a, b) => typeof b,
    '#instanceof#': (a, b) => a instanceof b,
    '#in#': (a, b) => a in b,
    'return': (a, b) => b,
    'var': (a, b, obj, context, scope, bobj) => {
        scope.declare(a, 'var', exec(b, scope, context));
        return new Prop(scope.var, a, false, bobj && bobj.isGlobal);
    },
    'let': (a, b, obj, context, scope, bobj) => {
        scope.declare(a, 'let', exec(b, scope, context), bobj && bobj.isGlobal);
        return new Prop(scope.let, a, false, bobj && bobj.isGlobal);
    },
    'const': (a, b, obj, context, scope, bobj) => {
        scope.declare(a, 'const', exec(b, scope, context));
        return new Prop(scope.const, a, false, bobj && bobj.isGlobal);
    },
    'arrowFunc': (a, b, obj, context, scope) => {
        return (...args) => {
            const vars = {};
            a.forEach((arg, i) => {
                vars[arg] = args[i];
            });
            return context.sandbox.executeTree({
                tree: b,
                strings: context.strings,
                literals: context.literals,
            }, [new Scope(scope, vars)]).result;
        };
    }
};
let ops = new Map();
for (let op in ops2) {
    ops.set(op, ops2[op]);
}
let lispTypes = {};
let setLispType = (types, fn) => {
    types.forEach((type) => {
        lispTypes[type] = fn;
    });
};
setLispType(['createArray', 'createObject', 'group', 'arrayProp', 'call'], (type, part, res, expect, ctx) => {
    let extract = "";
    let closings = {
        'createArray': ']',
        'createObject': '}',
        'group': ')',
        'arrayProp': ']',
        'call': ')'
    };
    let arg = [];
    let end = false;
    let i = 1;
    while (i < part.length && !end) {
        extract = restOfExp(part.substring(i), [
            new RegExp('^\\' + closings[type]),
            /^,/
        ]);
        i += extract.length;
        if (extract) {
            arg.push(extract);
        }
        if (part[i] !== ',') {
            end = true;
        }
        else {
            i++;
        }
    }
    const next = ['value', 'prop', 'function', 'exp', 'modifier', 'incrementerBefore'];
    let l;
    let fFound;
    const reg2 = /^([a-zA-Z\$_][a-zA-Z\d\$_]*)\((([a-zA-Z\$_][a-zA-Z\d\$_]*,?)*)\)?{/;
    switch (type) {
        case 'group':
        case 'arrayProp':
            l = lispify(arg.pop());
            break;
        case 'call':
        case 'createArray':
            l = arg.map((e) => lispify(e, [...next, 'spreadArray']));
            break;
        case 'createObject':
            l = arg.map((str) => {
                let value;
                let key;
                fFound = reg2.exec(str);
                if (fFound) {
                    let args = fFound[2].split(",");
                    const func = restOfExp(str.substring(fFound.index + fFound[0].length), [/^}/]);
                    return new ObjectFunc(fFound[1], args, Sandbox.parse(func, null).tree);
                }
                else {
                    let extract = restOfExp(str, [/^:/]);
                    key = lispify(extract, [...next, 'spreadObject']);
                    if (key instanceof Lisp && key.op === 'prop') {
                        key = key.b;
                    }
                    if (extract.length === str.length)
                        return key;
                    value = lispify(str.substring(extract.length + 1));
                }
                return new Lisp({
                    op: 'keyVal',
                    a: key,
                    b: value
                });
            });
            break;
    }
    type = type === 'arrayProp' ? 'prop' : type;
    ctx.lispTree = lispify(part.substring(i + 1), expectTypes[expect].next, new Lisp({
        op: type,
        a: ctx.lispTree,
        b: l,
    }));
});
setLispType(['op'], (type, part, res, expect, ctx) => {
    let extract = restOfExp(part.substring(res[0].length));
    ctx.lispTree = new Lisp({
        op: res[0],
        a: ctx.lispTree,
        b: lispify(extract),
    });
    ctx.lispTree = lispify(part.substring(extract.length + res[0].length), restOfExp.next, ctx.lispTree);
});
setLispType(['inverse', 'not', 'negative', 'positive', 'typeof'], (type, part, res, expect, ctx) => {
    let extract = restOfExp(part.substring(res[0].length));
    ctx.lispTree = new Lisp({
        op: ['positive', 'negative'].includes(type) ? '$' + res[0] : res[0],
        a: ctx.lispTree,
        b: lispify(extract, expectTypes[expect].next),
    });
    ctx.lispTree = lispify(part.substring(extract.length + res[0].length), restOfExp.next, ctx.lispTree);
});
setLispType(['incrementerBefore'], (type, part, res, expect, ctx) => {
    let extract = restOfExp(part.substring(2));
    ctx.lispTree = lispify(part.substring(extract.length + 2), restOfExp.next, new Lisp({
        op: res[0] + "$",
        a: lispify(extract, expectTypes[expect].next),
    }));
});
setLispType(['incrementerAfter'], (type, part, res, expect, ctx) => {
    ctx.lispTree = lispify(part.substring(res[0].length), expectTypes[expect].next, new Lisp({
        op: "$" + res[0],
        a: ctx.lispTree,
    }));
});
setLispType(['assign', 'assignModify'], (type, part, res, expect, ctx) => {
    ctx.lispTree = new Lisp({
        op: res[0],
        a: ctx.lispTree,
        b: lispify(part.substring(res[0].length), expectTypes[expect].next)
    });
});
setLispType(['split'], (type, part, res, expect, ctx) => {
    let extract = restOfExp(part.substring(res[0].length), [
        expectTypes.splitter.types.split,
        expectTypes.if.types.if,
        expectTypes.if.types.else
    ]);
    ctx.lispTree = new Lisp({
        op: res[0],
        a: ctx.lispTree,
        b: lispify(extract, expectTypes[expect].next),
    });
    ctx.lispTree = lispify(part.substring(extract.length + res[0].length), restOfExp.next, ctx.lispTree);
});
setLispType(['if'], (type, part, res, expect, ctx) => {
    let found = false;
    let extract = "";
    let quoteCount = 1;
    while (!found && extract.length < part.length) {
        extract += restOfExp(part.substring(extract.length + 1), [
            expectTypes.if.types.if,
            expectTypes.if.types.else
        ]);
        if (part[extract.length + 1] === '?') {
            quoteCount++;
        }
        else {
            quoteCount--;
        }
        if (!quoteCount) {
            found = true;
        }
        else {
            extract += part[extract.length + 1];
        }
    }
    ctx.lispTree = new Lisp({
        op: '?',
        a: ctx.lispTree,
        b: new Lisp({
            op: ':',
            a: lispify(extract),
            b: lispify(part.substring(res[0].length + extract.length + 1))
        })
    });
});
setLispType(['dot', 'prop'], (type, part, res, expect, ctx) => {
    let prop = res[0];
    let index = res[0].length;
    if (res[0] === '.') {
        let matches = part.substring(res[0].length).match(expectTypes.prop.types.prop);
        if (matches.length) {
            prop = matches[0];
            index = prop.length + res[0].length;
        }
        else {
            throw Error('Hanging  dot:' + part);
        }
    }
    ctx.lispTree = lispify(part.substring(index), expectTypes[expect].next, new Lisp({
        op: 'prop',
        a: ctx.lispTree,
        b: prop
    }));
});
setLispType(['spreadArray', 'spreadObject'], (type, part, res, expect, ctx) => {
    ctx.lispTree = new Lisp({
        op: type,
        b: lispify(part.substring(res[0].length), expectTypes[expect].next)
    });
});
setLispType(['number', 'boolean', 'null'], (type, part, res, expect, ctx) => {
    ctx.lispTree = lispify(part.substring(res[0].length), expectTypes[expect].next, JSON.parse(res[0]));
});
setLispType(['und'], (type, part, res, expect, ctx) => {
    ctx.lispTree = lispify(part.substring(res[0].length), expectTypes[expect].next, undefined);
});
setLispType(['NaN'], (type, part, res, expect, ctx) => {
    ctx.lispTree = lispify(part.substring(res[0].length), expectTypes[expect].next, NaN);
});
setLispType(['Infinity'], (type, part, res, expect, ctx) => {
    ctx.lispTree = lispify(part.substring(res[0].length), expectTypes[expect].next, Infinity);
});
setLispType(['string', 'literal'], (type, part, res, expect, ctx) => {
    ctx.lispTree = lispify(part.substring(res[0].length), expectTypes[expect].next, new Lisp({
        op: type,
        b: parseInt(JSON.parse(res[1]), 10),
    }));
});
setLispType(['return'], (type, part, res, expect, ctx) => {
    ctx.lispTree = new Lisp({
        op: 'return',
        b: lispify(part.substring(res[0].length), expectTypes[expect].next)
    });
});
setLispType(['initialize'], (type, part, res, expect, ctx) => {
    const split = res[0].split(/#/g);
    if (part.length === res[0].length) {
        ctx.lispTree = lispify(part.substring(res[0].length), expectTypes[expect].next, new Lisp({
            op: split[1],
            a: split[2]
        }));
    }
    else {
        ctx.lispTree = new Lisp({
            op: split[1],
            a: split[2],
            b: lispify(part.substring(res[0].length + 1), expectTypes[expect].next)
        });
    }
});
setLispType(['arrowFunc'], (type, part, res, expect, ctx) => {
    let args = res[1].split(",");
    if (res[2]) {
        if (res[0][0] !== '(')
            throw new Error('Unstarted inline function brackets: ' + res[0]);
    }
    else if (args.length) {
        args = [args.pop()];
    }
    const func = (res[3] ? '' : '#return#') + restOfExp(part.substring(res[0].length), res[3] ? [/^}/] : [/^[,;\)\}\]]/]);
    ctx.lispTree = lispify(part.substring(res[0].length + func.length + 1), expectTypes[expect].next, new Lisp({
        op: 'arrowFunc',
        a: args,
        b: Sandbox.parse(func, null).tree
    }));
});
function lispify(part, expected, lispTree) {
    expected = expected || ['initialize', 'expStart', 'value', 'function', 'prop', 'exp', 'modifier', 'incrementerBefore', 'expEnd'];
    if (!part.length && !expected.includes('expEnd')) {
        throw new Error("Unexpected end of expression");
    }
    let ctx = { lispTree: lispTree };
    let res;
    expected.forEach((expect) => {
        if (expect === 'expEnd') {
            return;
        }
        for (let type in expectTypes[expect].types) {
            if (res)
                break;
            if (type === 'expEnd') {
                continue;
            }
            if (res = expectTypes[expect].types[type].exec(part)) {
                lispTypes[type](type, part, res, expect, ctx);
                expected = expectTypes[expect].next;
            }
        }
    });
    if (!res && part.length) {
        throw Error("Unexpected token: " + part);
    }
    return ctx.lispTree;
}
function exec(tree, scope, context) {
    if (tree instanceof Prop) {
        return tree.context[tree.prop];
    }
    if (Array.isArray(tree)) {
        return tree.map((item) => exec(item, scope, context));
    }
    if (!(tree instanceof Lisp)) {
        return tree;
    }
    if (tree.op === 'arrowFunc') {
        return ops.get(tree.op)(tree.a, tree.b, undefined, context, scope);
    }
    let obj = exec(tree.a, scope, context);
    let a = obj instanceof Prop ? (obj.context ? obj.context[obj.prop] : undefined) : obj;
    let bobj = exec(tree.b, scope, context);
    let b = bobj instanceof Prop ? (bobj.context ? bobj.context[bobj.prop] : undefined) : bobj;
    if (ops.has(tree.op)) {
        let res = ops.get(tree.op)(a, b, obj, context, scope, bobj);
        return res;
    }
    throw new Error('Unknown operator: ' + tree.op);
}
let optimizeTypes = {};
let setOptimizeType = (types, fn) => {
    types.forEach((type) => {
        optimizeTypes[type] = fn;
    });
};
setOptimizeType(['>',
    '<',
    '>=',
    '<=',
    '==',
    '===',
    '!=',
    '!==',
    '&&',
    '||',
    '&',
    '|',
    '+',
    '-',
    '/',
    '*',
    '**',
    '%',
    '$+',
    '$-',
    '!',
    '~',
    'group'], (tree) => ops.get(tree.op)(tree.a, tree.b));
setOptimizeType(['string'], (tree, strings) => strings[tree.b]);
setOptimizeType(['literal'], (tree, strings, literals) => {
    if (!literals[tree.b].b.length) {
        return literals[tree.b].a;
    }
    return tree;
});
setOptimizeType(['createArray'], (tree) => {
    if (!tree.b.find((item) => item instanceof Lisp)) {
        return ops.get(tree.op)(tree.a, tree.b);
    }
    return tree;
});
setOptimizeType(['prop'], (tree) => {
    if (typeof tree.b === 'number' && tree.b % 1 === 0) {
        return tree.a[tree.b];
    }
    return tree;
});
function optimize(tree, strings, literals) {
    if (!(tree instanceof Lisp)) {
        if (Array.isArray(tree)) {
            for (let i = 0; i < tree.length; i++) {
                tree[i] = optimize(tree[i], strings, literals);
            }
            return tree;
        }
        return tree;
    }
    else {
        tree.a = optimize(tree.a, strings, literals);
        tree.b = optimize(tree.b, strings, literals);
    }
    if (!(tree.a instanceof Lisp) && !(tree.b instanceof Lisp) && optimizeTypes[tree.op]) {
        return optimizeTypes[tree.op](tree, strings, literals);
    }
    return tree;
}
export default class Sandbox {
    constructor(globals = {}, prototypeWhitelist = new Map(), options = { audit: false }) {
        const sandboxGlobal = new SandboxGlobal(globals);
        this.context = {
            sandbox: this,
            globals,
            prototypeWhitelist,
            options,
            globalScope: new Scope(null, globals, sandboxGlobal),
            sandboxGlobal,
            Function: () => () => { },
            eval: () => { },
            auditReport: {
                prototypeAccess: {},
                globalsAccess: new Set()
            }
        };
        this.context.Function = sandboxFunction(this.context);
        this.context.eval = sandboxedEval(this.context.Function);
    }
    static get SAFE_GLOBALS() {
        return {
            Function,
            eval,
            console,
            isFinite,
            isNaN,
            parseFloat,
            parseInt,
            decodeURI,
            decodeURIComponent,
            encodeURI,
            encodeURIComponent,
            escape,
            unescape,
            Boolean,
            Number,
            String,
            Object,
            Array,
            Symbol,
            Error,
            EvalError,
            RangeError,
            ReferenceError,
            SyntaxError,
            TypeError,
            URIError,
            Int8Array,
            Uint8Array,
            Uint8ClampedArray,
            Int16Array,
            Uint16Array,
            Int32Array,
            Uint32Array,
            Float32Array,
            Float64Array,
            Map,
            Set,
            WeakMap,
            WeakSet,
            Promise,
            Intl,
            JSON,
            Math,
        };
    }
    static get SAFE_PROTOTYPES() {
        let protos = [
            SandboxGlobal,
            Function,
            Boolean,
            Object,
            Number,
            String,
            Date,
            RegExp,
            Error,
            Array,
            Int8Array,
            Uint8Array,
            Uint8ClampedArray,
            Int16Array,
            Uint16Array,
            Int32Array,
            Uint32Array,
            Float32Array,
            Float64Array,
            Map,
            Set,
            WeakMap,
            WeakSet,
            Promise,
        ];
        let map = new Map();
        protos.forEach((proto) => {
            map.set(proto, []);
        });
        return map;
    }
    static audit(code, scopes = []) {
        let allowed = new Map();
        return new Sandbox(globalThis, allowed, {
            audit: true,
        }).executeTree(Sandbox.parse(code), scopes);
    }
    static parse(code, strings = [], literals = []) {
        // console.log('parse', str);
        let str = code;
        let quote;
        let extract = "";
        let escape = false;
        let js = [];
        let extractSkip = 0;
        for (let i = 0; i < str.length; i++) {
            let char = str[i];
            if (escape) {
                if (char === "$" && quote === '`') {
                    extractSkip--;
                    char = '$$';
                }
                else if (char === 'u') {
                    let reg = /^[a-fA-F\d]{2,4}/.exec(str.substring(i + 1));
                    let num;
                    if (!reg) {
                        num = Array.from(/^{[a-fA-F\d]+}/.exec(str.substring(i + 1)) || [""]);
                    }
                    else {
                        num = Array.from(reg);
                    }
                    char = JSON.parse(`"\\u${num[0]}"`);
                    str = str.substring(0, i - 1) + char + str.substring(i + (1 + num[0].length));
                    i -= 1;
                }
                else if (char != '`') {
                    char = JSON.parse(`"\\${char}"`);
                }
            }
            else if (char === '$' && quote === '`' && str[i + 1] !== '{') {
                extractSkip--;
                char = '$$';
            }
            if (quote === "`" && char === "$" && str[i + 1] === "{") {
                let skip = restOfExp(str.substring(i + 2), [/^}/]);
                js.push(this.parse(skip, strings, literals).tree[0]);
                extractSkip += skip.length + 3;
                extract += `\${${js.length - 1}}`;
                i += skip.length + 2;
            }
            else if (!quote && (char === "'" || char === '"' || char === '`') && !escape) {
                js = [];
                extractSkip = 0;
                quote = char;
            }
            else if (quote === char && !escape) {
                let len;
                if (quote === '`') {
                    if (strings !== null) {
                        literals.push({
                            op: 'literal',
                            a: extract,
                            b: js
                        });
                        str = str.substring(0, i - extractSkip - 1) + `\`${literals.length - 1}\`` + str.substring(i + 1);
                        len = (literals.length - 1).toString().length;
                    }
                }
                else {
                    if (strings !== null) {
                        strings.push(extract);
                        str = str.substring(0, i - extract.length - 1) + `"${strings.length - 1}"` + str.substring(i + 1);
                        len = (strings.length - 1).toString().length;
                    }
                }
                quote = null;
                i -= extract.length - len;
                extract = "";
            }
            else if (quote && !(!escape && char === "\\")) {
                extractSkip += escape ? 1 + char.length : char.length;
                extract += char;
            }
            escape = quote && !escape && char === "\\";
        }
        const functions = [];
        if (strings !== null) {
            const hi = str.indexOf('#');
            if (hi > -1)
                throw Error('Unexpected token: ' + str.substring(hi));
            str = str.replace(/(?<=(^|[^\w_$]))(var|let|const|typeof|return|instanceof|in)(?=([^\w_$]|$))/g, (match) => {
                return `#${match}#`;
            }).replace(/\s/g, "");
        }
        const parts = [];
        let part;
        let pos = 0;
        while ((part = restOfExp(str.substring(pos), [/^;/]))) {
            parts.push(part);
            pos += part.length + 1;
        }
        const tree = parts.filter((str) => str.length).map((str) => {
            return lispify(str);
        }).map((tree) => optimize(tree, strings, literals));
        return { tree, strings, literals };
    }
    executeTree(executionTree, scopes = []) {
        const execTree = executionTree.tree;
        const contextb = { ...this.context, strings: executionTree.strings, literals: executionTree.literals };
        let scope = this.context.globalScope;
        let s;
        while (s = scopes.shift()) {
            if (typeof s !== "object")
                continue;
            if (s instanceof Scope) {
                scope = s;
            }
            else {
                scope = new Scope(scope, s);
            }
        }
        let context = Object.assign({}, contextb);
        if (contextb.options.audit) {
            context.auditReport = {
                globalsAccess: new Set(),
                prototypeAccess: {},
            };
        }
        let returned = false;
        let res;
        if (!(execTree instanceof Array))
            throw new Error('Bad execution tree');
        execTree.map(tree => {
            if (!returned) {
                const r = exec(tree, scope, context);
                if (tree instanceof Lisp && tree.op === 'return') {
                    returned = true;
                    res = r;
                }
            }
            return null;
        });
        res = res instanceof Prop ? res.context[res.prop] : res;
        return { auditReport: context.auditReport, result: res };
    }
    compile(code) {
        const executionTree = Sandbox.parse(code);
        return (...scopes) => {
            return this.executeTree(executionTree, scopes).result;
        };
    }
    ;
}
