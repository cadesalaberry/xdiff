
//inject a matchRef, isRef, and a getRef function?
//could use the same pattern with objects.

//I don't really want to force __id__
//should be able to use anything, aslong as you 

module.exports = customize();
module.exports.customize = customize;

function customize (getId, toPointer, isPointer, encodePath, decodePath) {

  var api = {}

  if (!getId) getId = function (obj) {
    return obj.__id__
  };

  if (!toPointer) toPointer = function (v) {
    //TODO escape strings that happen to start with #*=
    var r
    if(r = isRef(v)) return '#*='+r
    return v
  }

  if (!isPointer) isPointer = function (v) {
    return 'string' == typeof v && /^#\*=/.test(v) ? v.substring(3) : null
  }

  if (!encodePath) encodePath = function (p) {
    return p.slice()
  }

  if (!decodePath) decodePath = function (path) {
    return path.slice()
  }

  function shallowEqual (a, b) {
      if(isObject(a) 
        && isObject(b) 
        && (getId(a) == getId(b) || a === b))
        return true
      if(a && !b) return false
      return a == b
    }


  function equal (a, b) {
   if((a && !b) || (!a && b)) return false
    if(Array.isArray(a))
      if(a.length != b.length) return false
    if(isObject(a) && isObject(b)) {
      if (getId(a) == getId(b) || a === b)
        return true
      for(var i in a)
        if(!equal(a[i], b[i])) return false
      return true
    }
    if(a == null && b == null) return true
    return a === b
  }

  var adiff = require('adiff')({ equal: equal })

  function findRefs(obj, refs) {
    refs = refs || {}
    //add leaves before branches.
    //this will FAIL if there are circular references.

    if(!obj)
      return refs

    for(var k in obj) {
      if(obj[k] && 'object' == typeof obj[k])
        findRefs(obj[k], refs)
    }

    var id = getId(obj)
    if(id && !refs[id])
      refs[id] = obj
    return refs
  }

  function isObject (o) {
    return o && 'object' == typeof o
  }

  function isRef(x) {
    return x ? getId(x) : undefined
  }

  function sameRef(a, b) {
    return a && b && isRef(a) == isRef(b)
  }

  //traverse o, and replace every object with __id__ with a pointer.
  //make diffing references easy.


  api.deref = function (o, mutate) {
    var refs = findRefs(o)
    function deref (o, K) {
      if(isRef(o) && K != isRef(o))
        return toPointer(o)
   
      var p = mutate ? o : Array.isArray(o) ? [] : {} //will copy the tree!
      for (var k in o) {
        var r 
        if(isRef(o[k])) p[k] = toPointer(o[k])
        else if(isObject(o[k])) p[k] = deref(o[k])
        else p[k] = o[k]
      }
      return p
    }
    
    refs.root = o
    for (var k in refs)
      refs[k] = deref(refs[k], k)
    return refs
  }

  api.reref = function (refs, mutate) {

    function fromRef(v) {
      //TODO escape strings that happen to start with #*=
      var id = isPointer(v)
      console.log('id', v, id)
      if(id) return refs[id]
        return v
    }

    function reref (o) { //will MUTATE the tree
      if(!isObject(o))
        return fromRef(o)

      var p = mutate ? o : Array.isArray(o) ? [] : {} //will copy the tree!
      for (var k in o) {
        if(isObject(o[k]))
           p[k] = reref(o[k])
        else
          p[k] = fromRef(o[k])
      }
      return p
    }
    //if the root is a ref. need a special case
    for (var k in refs) {
      refs[k] = reref(refs[k])
    }
    return refs.root
  }

  api.diff = function (a, b) {

    var aRefs = api.deref(a)
    var bRefs = api.deref(b)

    var seen = []

    for (var k in aRefs)
      seen.push(k)

   function isSeen(o) {
      if(isRef(o)) return ~seen.indexOf(getId(o))
      return true 
    }
    function addSeen(o) {
      if(!isRef(o)) return o
      if(!isSeen(o)) seen.push(getId(o))
      return o
    }

    // how to handle references?
    // this is necessary to handle objects in arrays nicely
    // otherwise mergeing an edit and a move is ambigous.  // will need to perform a topoligical sort of the refs and diff them first, in that order.
    // first, apply changes to all refs,
    // then traverse over the root object,

    function _diff (a, b, path) {
      path = path || []

      if(Array.isArray(a) && Array.isArray(b)) {
        var d = adiff.diff(a, b)
        if(d.length) delta.push(['splice', encodePath(path), d])
        return delta
      }

  // references to objects with ids are
  // changed into strings of thier id.
  // the string is prepended with '#*='
  // to distinguish it from other strings
  // if you use that string in your model,
  // it will break.
  // TODO escape strings so this is safe

     //ah, treat root like it's a __id__

      for (var k in b) {
        // if both are nonRef objects, or are the same object, branch into them.
      
      if(isObject(a[k]) && isObject(b[k]) && sameRef(b[k], a[k])) 
        _diff(a[k], b[k], path.concat(k))
      else if(b[k] !== a[k])
        delta.push(['set', encodePath(path.concat(k)), cpy(b[k])])
      }
      
      for (var k in a)
        if('undefined' == typeof b[k])
          delta.push(['del', encodePath(path.concat(k))])
    }

    var delta = []
    _diff(aRefs, bRefs)

    return cpy(delta)
  }

  api.patch = function (a, patch) {

    if(!patch) throw new Error('expected patch')
    a = cpy(a)

    var refs = api.deref(a, true)
    refs.root = a

    var methods = {
      set: function (key, value) {
        this[key] = cpy(value) // incase this was a reference, remove it.
      },
      del: function (key) {
        delete this[key]
      },
      splice: function (changes) {
        adiff.patch(this, changes, true)
      }
    }

    function pathTo(a, p) {
      for (var i in p) a = a[p[i]]
      return a
    }

    patch.forEach(function (args) {
      args = args.slice()
      var method = args.shift()
      var path = decodePath(args.shift())
      
      var key
      if(method != 'splice') {
        key = path.pop()
        args.unshift(key)
      }
      var obj = pathTo(refs, path)
      methods[method].apply(obj, args)
    })

    return api.reref(refs, true)
  }

  function cpy(o) {
    if(!o) return o
    return JSON.parse(JSON.stringify(o))
  }

  api.diff3 = function (a, o, b) {
    if(arguments.length == 1)
      o = a[1], b = a[2], a = a[0]
    var _a = api.diff(o, a) || [] // if there where no changes, still merge
      , _b = api.diff(o, b) || []

    function cmp (a, b) {
      //check if a[1] > b[1]
      if(!b)
        return 1

      var p = a[1], q = b[1]
      var i = 0
      while (p[i] === q[i] && p[i] != null)
        i++

      if(p[i] === q[i]) return 0
      return p[i] < q[i] ? -1 : 1
    }

    function isPrefix(a, b) {
      if(!b) return 1
      var p = a[1], q = b[1]
      var i = 0
      while (p[i] === q[i] && i < p.length && i < q.length)
        i++
      if(i == p.length || i == q.length) return 0
      return p[i] < q[i] ? -1 : 1 
    }

    //merge two lists, which must be sorted.

    function cmpSp (a, b) {
      if(a[0] == b[0])
        return 0
      function max(k) {
        return k[0] + (k[1] >= 1 ? k[1] - 1 : 0)
      }
      if(max(a) < b[0] || max(b) < a[0])
        return a[0] - b[0]
      return 0
    }

    function resolveAry(a, b) {
      return a
    }

    function resolve(a, b) {
      if(a[1].length == b[1].length) { 
        if(a[0] == b[0]) {
          if(a[0] == 'splice') {
            var R = merge(a[2], b[2], cmpSp, resolveAry)
            return ['splice', a[1].slice(), R]
          } else if(equal(a[2], b[2])) //same change both sides.
            return a
        }
      }
      return a
    }

    function merge(a, b, cmp, resolve) {
      var i = a.length - 1, j = b.length - 1, r = []
      while(~i && ~j) {
        var c = cmp(a[i], b[j])
        if(c > 0) r.push(a[i--])
        if(c < 0) r.push(b[j--])
        if(!c) {
          var R = resolve(a[i], b[j])
            j--, i--
          r.push(R)
        }
      }
      //finish off the list if there are any left over
      while(~i) r.push(a[i--])
      while(~j) r.push(b[j--])
      return r
    }

    _a.sort(cmp)
    _b.sort(cmp)

    return merge(_a, _b, isPrefix, resolve)
  }

  return api;
};
