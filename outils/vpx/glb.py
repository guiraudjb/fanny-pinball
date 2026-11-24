import json,struct,numpy as np
def charger(chemin):
    b=open(chemin,'rb').read()
    l=struct.unpack('<I',b[12:16])[0]; g=json.loads(b[20:20+l])
    off=20+l; l2=struct.unpack('<I',b[off:off+4])[0]; binr=b[off+8:off+8+l2]
    return g,binr
CT={5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def acc(g,binr,i):
    a=g['accessors'][i]; bv=g['bufferViews'][a['bufferView']]
    dt=CT[a['componentType']]; n=NC[a['type']]
    o=bv.get('byteOffset',0)+a.get('byteOffset',0); st=bv.get('byteStride',0)
    isz=np.dtype(dt).itemsize*n
    if st and st!=isz:
        raw=np.frombuffer(binr,np.uint8,count=st*(a['count']-1)+isz,offset=o)
        arr=np.lib.stride_tricks.as_strided(raw,(a['count'],isz),(st,1)).copy().view(dt).reshape(a['count'],n)
    else:
        arr=np.frombuffer(binr,dt,count=a['count']*n,offset=o).reshape(a['count'],n)
    if a.get('normalized'): arr=arr.astype(np.float32)/np.iinfo(dt).max
    return arr.astype(np.float32) if dt==np.float32 else arr
def matrice(nd):
    if 'matrix' in nd: return np.array(nd['matrix'],np.float64).reshape(4,4).T
    t=np.array(nd.get('translation',[0,0,0])); q=nd.get('rotation',[0,0,0,1]); s=np.array(nd.get('scale',[1,1,1]))
    x,y,z,w=q
    R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    M=np.eye(4); M[:3,:3]=R*s; M[:3,3]=t; return M
def parcourir(g):
    out=[]
    def rec(i,P,chemin):
        nd=g['nodes'][i]; M=P@matrice(nd); ch=chemin+[nd.get('name') or '']
        if 'mesh' in nd: out.append((i,M,ch))
        for c in nd.get('children',[]): rec(c,M,ch)
    for r in g['scenes'][0]['nodes']: rec(r,np.eye(4),[])
    return out
