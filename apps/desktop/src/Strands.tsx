import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';
import './Strands.css';

const MAX_STRANDS = 12, MAX_COLORS = 8;
const VERT = `#version 300 es
in vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
const FRAG = `#version 300 es
precision highp float;
uniform float uTime,uSpeed,uAmplitude,uWaviness,uThickness,uGlow,uTaper,uSpread,uHueShift,uIntensity,uOpacity,uScale,uSaturation;
uniform vec2 uResolution; uniform vec3 uColors[${MAX_COLORS}]; uniform int uColorCount,uStrandCount; out vec4 fragColor;
const float PI=3.14159265;
vec3 spectrum(float t){return .5+.5*cos(2.*PI*(t+vec3(0.,.33,.67)));}
vec3 palette(float t){if(uColorCount==0)return spectrum(t);float s=fract(t)*float(uColorCount);int a=int(floor(s)),b=a+1;if(b>=uColorCount)b=0;return mix(uColors[a],uColors[b],fract(s));}
void main(){vec2 uv=(gl_FragCoord.xy-.5*uResolution)/uResolution.y;uv/=max(uScale,.0001);float e=.06+uIntensity*.94;float env=pow(max(cos(uv.x*PI*1.3),0.),uTaper);vec3 col=vec3(0.);
for(int i=0;i<${MAX_STRANDS};i++){if(i>=uStrandCount)break;float fi=float(i),ph=fi*1.7*uSpread,f=(2.+fi*.35)*uWaviness,spd=1.4+fi*1.2,tt=uTime*uSpeed;float w=sin(uv.x*f+tt*spd+ph)*.6+sin(uv.x*f*1.1-tt*spd*.7+ph*1.7)*.4;float y=w*(.1+.02*e)*env*uAmplitude,d=abs(uv.y-y),th=(.001+.05*e)*(.35+env)*uThickness,g=th/(d+th*.45);g*=g;col+=palette(fi/float(uStrandCount)+uv.x*.3+uTime*.04+uHueShift)*g*env;}
col*=.45+.7*e;col=1.-exp(-col*uGlow);float gray=dot(col,vec3(.2126,.7152,.0722));col=max(mix(vec3(gray),col,uSaturation),0.);float a=clamp(max(max(col.r,col.g),col.b),0.,1.)*uOpacity;fragColor=vec4(col*uOpacity,a);}`;
const buildPalette=(colors:string[])=>Array.from({length:MAX_COLORS},(_,i)=>{const c=new Color(colors[i]??colors.at(-1)??'#fff');return[c.r,c.g,c.b]});
export type StrandsProps={colors?:string[];count?:number;speed?:number;amplitude?:number;waviness?:number;thickness?:number;glow?:number;taper?:number;spread?:number;hueShift?:number;intensity?:number;saturation?:number;opacity?:number;scale?:number;className?:string;style?:React.CSSProperties};
export default function Strands(props:StrandsProps){const current=useRef(props);current.current=props;const host=useRef<HTMLDivElement>(null);
useEffect(()=>{const c=host.current;if(!c)return;const renderer=new Renderer({alpha:true,premultipliedAlpha:true,antialias:true}),gl=renderer.gl;gl.clearColor(0,0,0,0);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);const geometry=new Triangle(gl);if(geometry.attributes.uv)delete geometry.attributes.uv;
const defaults={colors:['#ff183e','#9e2038','#681728'],count:3,speed:.7,amplitude:1,waviness:1.1,thickness:.65,glow:2,taper:2.5,spread:2,hueShift:0,intensity:.35,saturation:1.4,opacity:1,scale:1.2};
const program=new Program(gl,{vertex:VERT,fragment:FRAG,uniforms:Object.fromEntries(['uTime','uSpeed','uAmplitude','uWaviness','uThickness','uGlow','uTaper','uSpread','uHueShift','uIntensity','uOpacity','uScale','uSaturation'].map(k=>[k,{value:k==='uTime'?0:1}])).concat([['uResolution',{value:[1,1]}],['uColors',{value:buildPalette(defaults.colors)}],['uColorCount',{value:3}],['uStrandCount',{value:3}]])});const mesh=new Mesh(gl,{geometry,program});c.appendChild(gl.canvas);
const resize=()=>{renderer.setSize(c.clientWidth,c.clientHeight);program.uniforms.uResolution.value=[c.clientWidth,c.clientHeight]};addEventListener('resize',resize);resize();let frame=0;const tick=(t:number)=>{frame=requestAnimationFrame(tick);const p={...defaults,...current.current};program.uniforms.uTime.value=t*.001;program.uniforms.uColors.value=buildPalette(p.colors);program.uniforms.uColorCount.value=Math.min(p.colors.length,MAX_COLORS);program.uniforms.uStrandCount.value=Math.min(Math.max(Math.round(p.count),1),MAX_STRANDS);for(const k of ['speed','amplitude','waviness','thickness','glow','taper','spread','hueShift','intensity','opacity','scale','saturation'] as const)program.uniforms['u'+k[0].toUpperCase()+k.slice(1)].value=p[k];renderer.render({scene:mesh})};frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);removeEventListener('resize',resize);gl.canvas.remove();gl.getExtension('WEBGL_lose_context')?.loseContext()}},[]);
return <div ref={host} className={`strands-container ${props.className??''}`} style={props.style}/>}
