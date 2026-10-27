"""Poster assets from test evidence; no patient records are read."""
import json,math,zipfile
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from PIL import Image
import pypdfium2 as pdfium
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output/key-metrics';QA=ROOT/'tmp/key-metrics'
for p in [OUT,QA,OUT/'PNG_прозрачные',OUT/'PNG_белый_фон',OUT/'PDF',OUT/'Протоколы']:p.mkdir(parents=True,exist_ok=True)
for n,f in [('Text','C:/Windows/Fonts/segoeui.ttf'),('Bold','C:/Windows/Fonts/seguisb.ttf'),('Num','C:/Users/nefon/.agents/skills/canvas-design/canvas-fonts/JetBrainsMono-Bold.ttf')]:pdfmetrics.registerFont(TTFont(n,f))
C=dict(ink='#173F36',green='#2E7863',mint='#DDEEE5',light='#EDF5F0',muted='#5F726A',line='#D6E3DB',purple='#746195',lilac='#F0ECF6',white='#FFFFFF',paper='#F4F7F3')
W,H=576,384
read=lambda f:json.loads((ROOT/'docs/evidence'/f).read_text(encoding='utf-8-sig'))
u=read('key-metrics-unit-2026-10-26.json');assert u['success'] and u['numFailedTests']==0;N=u['numPassedTests']
loads=[read(f'read-concurrency-{n}.json') for n in [1,8,24]];assert all(d['errors']==0 for d in loads)
lat=loads[-1];p95=math.ceil(max(e['p95Ms'] for e in lat['endpoints']));total=sum(d['requests'] for d in loads)
b=read('backup-verification.json');assert b['restore']['contentMatches'];restore=f"{b['restore']['durationMs']/1000:.3f}".replace('.',',')
e=read('extraction-evaluation.json');assert e['matchedCases']==6
x=read('extensibility.json');assert x['coreUnchanged'] and x['newScalePublished'] and x['newVersionPublished']
a=read('key-metrics-access-2026-10-26.json');assert a['stats']['unexpected']==0 and a['stats']['expected']>=1
(OUT/'Визуальный_принцип.md').write_text('''# Точный ритм

Пространство работает как часть доказательства: крупное число получает воздух, а тонкая шкала связывает его с измерением. Композиция строится на ясной оси, без украшений, которые могли бы притвориться данными.

Глубокий зелёный задаёт спокойствие; шалфей поддерживает успешные проверки, а сиреневый выделяет машинную обработку. Кропотливая работа с оттенками важнее эффектности: цвет различает результаты, а не обещает качество.

Монументальная моноширинная цифра соседствует с человеческим ритмом кириллического гротеска. Подпись сообщает только то, что нельзя выразить формой. Мастерство проявляется в точных интервалах и оптически равных полях.

Каждая панель использует свой язык: длина полосы, множество отметок, граница доступа, перенос копии, проверенные случаи и поток модулей. Аккуратно собранные детали связывают набор; границы измерения остаются частью композиции.
''',encoding='utf-8')
class Art:
 def __init__(self,c,h,ox=0,oy=0):self.c,self.h,self.ox,self.oy=c,h,ox,oy
 def color(self,k):return HexColor(C.get(k,k))
 def text(self,x,y,t,s=12,f='Text',col='ink',align='left'):
  c=self.c;c.setFillColor(self.color(col));c.setFont(f,s)
  if self.h==H and align=='left':assert x+pdfmetrics.stringWidth(t,f,s)<=W-18,f'Overflow: {t}'
  {'left':c.drawString,'right':c.drawRightString,'center':c.drawCentredString}[align](self.ox+x,self.h-self.oy-y,t)
 def line(self,x,y,x2,y2,col='line',w=1):
  c=self.c;c.setStrokeColor(self.color(col));c.setLineWidth(w);c.setLineCap(1);c.line(self.ox+x,self.h-self.oy-y,self.ox+x2,self.h-self.oy-y2)
 def box(self,x,y,w,h,fill='light',r=0,stroke=None):
  c=self.c;c.setFillColor(self.color(fill));c.setStrokeColor(self.color(stroke or fill));c.setLineWidth(.8);c.roundRect(self.ox+x,self.h-self.oy-y-h,w,h,r,fill=1,stroke=bool(stroke))
 def circle(self,x,y,r,fill='mint'):
  self.c.setFillColor(self.color(fill));self.c.circle(self.ox+x,self.h-self.oy-y,r,fill=1,stroke=0)
 def check(self,x,y,s=6,col='green'):
  self.line(x-s*.5,y,x-s*.12,y+s*.32,col,1.6);self.line(x-s*.12,y+s*.32,x+s*.55,y-s*.4,col,1.6)
 def arrow(self,x,y,x2,y2):
  self.line(x,y,x2,y2,'green',1.5);t=math.atan2(y2-y,x2-x)
  for sign in [-1,1]:self.line(x2,y2,x2-7*math.cos(t+sign*.5),y2-7*math.sin(t+sign*.5),'green',1.5)
 def doc(self,x,y,col='green',fill='light',w=32,h=42):
  self.box(x,y,w,h,fill,4,col)
  for j in range(3):self.line(x+7,y+12+j*8,x+w-7,y+12+j*8,col,.9)
 def db(self,x,y):
  c=self.c;c.setFillColor(self.color('light'));c.setStrokeColor(self.color('green'));c.setLineWidth(1.4);c.rect(self.ox+x,self.h-self.oy-y-48,64,45,fill=1,stroke=0)
  for d in [48,30,14,0]:c.ellipse(self.ox+x,self.h-self.oy-y-d-8,self.ox+x+64,self.h-self.oy-y-d+8,fill=1,stroke=1)
  self.line(x,y,x,y+48,'green',1.4);self.line(x+64,y,x+64,y+48,'green',1.4)
 def metric(self,v,unit='',s=82,col='ink'):
  self.text(30,145,v,s,'Num',col)
  if unit:self.text(42+pdfmetrics.stringWidth(v,'Num',s),144,unit,25,col=col)
 def header(self,t,date):
  self.text(30,43,t,22,'Bold');self.text(W-30,65,date,8.3,col='muted',align='right');self.line(30,61,74,61,'green',3)
titles=['Быстродействие','Надёжность','Разграничение доступа','Восстановление данных','Извлечение сведений','Расширяемость']
names=['01_Быстродействие','02_Надёжность','03_Доступ','04_Восстановление','05_Извлечение_сведений','06_Расширяемость']
def panel(g,i):
 g.header(titles[i],'26.10.2026' if i<3 else '24.10.2026')
 if i==0:
  g.metric(str(p95),'мс');g.text(32,176,'p95 ответа сервера')
  for j,row in enumerate(lat['endpoints']):
   y=214+j*33;label={'directory':'Список','detail':'Карточка','history':'История'}[row['kind']];g.text(32,y+10,label,11);g.box(151,y,315,12,'light',3);g.box(151,y,315*row['p95Ms']/200,12,'green',3);g.text(544,y+10,str(row['p95Ms']).replace('.',','),11,'Num','green','right')
  for t in [0,50,100,150,200]:
   xx=151+315*t/200;g.line(xx,310,xx,315);g.text(xx,330,str(t),8.3,'Num','muted','center')
  g.text(32,353,'24 параллельных запроса · 120 пациентов · 4200 записей',8.8,col='muted');g.text(32,371,f'0 HTTP-ошибок / {total} запросов в трёх локальных режимах',9,'Bold','green')
 elif i==1:
  g.metric(f'{N}/{N}',s=76);g.text(32,176,'модульных проверок пройдено')
  for k in range(N):
   xx=32+(k%16)*32;yy=212+(k//16)*16;g.box(xx,yy,26,10,'mint',2);g.check(xx+13,yy+5,4.5)
  g.text(32,354,'Каждая отметка — одна пройденная проверка',9,col='muted');g.text(32,372,'Локальный прогон · не оценка клинической эффективности',8.8,col='muted')
 elif i==2:
  g.metric('3');g.text(32,176,'проверки доступа на API экспорта')
  for j,(code,label) in enumerate([('401','Без сессии'),('403','Другая роль'),('404','Чужая карточка')]):
   xx=32+j*174;g.box(xx,216,158,94,'light',8);g.line(xx+18,232,xx+140,232,'mint',2);g.text(xx+79,269,code,30,'Num','green','center');g.text(xx+79,294,label,10,align='center')
  g.box(415,90,48,54,'mint',8);g.check(439,117,15)
  g.text(32,352,'Все три запроса без доступа отклонены',10,'Bold');g.text(32,371,'Подтверждено автотестом · не пентест и не сертификация',8.8,col='muted')
 elif i==3:
  g.metric(restore,'с',s=76);g.text(32,176,'восстановление тестовой копии БД');g.db(58,231);g.db(454,231);g.arrow(151,258,424,258);g.text(288,240,'Резервная копия',11,'Bold',align='center');g.text(90,312,'Исходная БД',10,align='center');g.text(486,312,'Восстановленная',10,align='center')
  for k in range(b['criticalTableCount']):g.box(211+(k%12)*13,279+(k//12)*12,8,7,'green',1)
  g.text(32,352,f"Содержимое {b['criticalTableCount']} таблиц совпало",11,'Bold');g.text(32,371,'Один локальный замер · развёртывание сервера не включено',8.8,col='muted')
 elif i==4:
  g.metric('6/6',col='purple');g.text(32,176,'учебных сценариев извлечения пройдено')
  for j,label in enumerate(['Аллергия','Отмена препарата','Приём препарата','Отрицание','Неопределённость','Чужие команды']):
   xx=32+(j%3)*174;yy=205+(j//3)*62;g.doc(xx,yy,'purple','lilac');g.circle(xx+29,yy+34,9,'white');g.check(xx+29,yy+34,6,'purple');g.text(xx+45,yy+25,label,10)
  g.text(32,352,'Mistral · результат совпал с ожидаемым',10,'Bold');g.text(32,371,'6 синтетических примеров · не клиническая точность',8.8,col='muted')
 elif i==5:
  g.metric('JSON',s=76);g.text(32,176,'новая шкала без правок расчётного ядра');g.doc(51,222,w=62,h=58);g.text(82,260,'{ }',21,'Num','green','center');g.arrow(136,252,202,252);g.box(220,219,138,70,'mint',8);g.text(289,249,'Расчётное',12,'Bold',align='center');g.text(289,267,'ядро',12,'Bold',align='center');g.arrow(376,252,440,252);g.doc(462,222,w=62,h=58);g.circle(518,269,11,'white');g.check(518,269,7)
  for xx,t in [(82,'Описание шкалы'),(289,'Без изменений'),(493,'Новая форма')]:g.text(xx,312,t,9.5,align='center')
  g.text(32,352,'Публикация новой шкалы и версии проверена',10,'Bold');g.text(32,371,'Новые алгоритмы и интеграции требуют разработки',8.8,col='muted')
def render(pdf,target,scale=300/72,alpha=False):
 d=pdfium.PdfDocument(str(pdf));im=d[0].render(scale=scale,fill_color=(255,255,255,0) if alpha else (255,255,255,255)).to_pil().convert('RGBA');im.save(target,dpi=(300,300));d.close();return im
for i,n in enumerate(names):
 f=OUT/'PDF'/f'{n}.pdf';c=canvas.Canvas(str(f),pagesize=(W,H),pageCompression=1);c.setTitle('Контур · '+titles[i]);panel(Art(c,H),i);c.showPage();c.save();assert titles[i] in PdfReader(str(f)).pages[0].extract_text()
 im=render(f,OUT/'PNG_прозрачные'/f'{n}.png',alpha=True);assert im.getpixel((0,0))[3]==0
 white=Image.new('RGBA',im.size,'white');white.alpha_composite(im);white.convert('RGB').save(OUT/'PNG_белый_фон'/f'{n}.png',dpi=(300,300))
BW,BH=1248,1410;f=OUT/'Контур_Ключевые_метрики.pdf';c=canvas.Canvas(str(f),pagesize=(BW,BH),pageCompression=1);g=Art(c,BH);g.box(0,0,BW,BH,'paper');g.text(36,48,'КОНТУР',32,'Bold');g.text(36,78,'Ключевые технические результаты',14,col='muted');g.text(BW-36,48,'УЧЕБНАЯ ВЕРСИЯ',10,'Bold','green','right')
for i in range(6):
 xx=36+(i%2)*(W+24);yy=104+(i//2)*(H+24);g.box(xx,yy,W,H,'white',14,'line');panel(Art(c,BH,xx,yy),i)
g.text(36,1338,'Измерено и проверено на синтетических данных.',12,'Bold');g.text(36,1361,'Локальные технические испытания. Клиническая валидация и испытания в эксплуатации не проводились.',11,col='muted');g.text(36,1384,'Даты и условия указаны на каждой панели; полные протоколы — в комплекте.',10,col='muted');c.showPage();c.save()
im=render(f,OUT/'Контур_Ключевые_метрики.png',scale=2.5);im.thumbnail((1500,1800));im.save(OUT/'Предпросмотр.png')
notes=f'''# Ключевые метрики для постера

Шесть отдельных изображений и общий лист. PNG_прозрачные: 2400 × 1600 px, 300 dpi, без фоновой плашки. PNG_белый_фон: те же изображения на белом. PDF/: векторные версии для увеличения при печати. Общий лист — Контур_Ключевые_метрики.png / .pdf.

## Данные и границы

1. Быстродействие: верхнее значение p95 трёх API при 24 параллельных запросах — {p95} мс после округления вверх. Список {lat['endpoints'][0]['p95Ms']} мс, карточка {lat['endpoints'][1]['p95Ms']} мс, история {lat['endpoints'][2]['p95Ms']} мс. Это p95 времени HTTP-ответа в локальном окружении, не максимум задержки и не время отрисовки. По 180 запросов при параллельности 1/8/24, всего {total}, HTTP-ошибок нет. 120 синтетических пациентов, 4200 записей. Свежий прогон 26.10.2026. Не предел пользователей production.
2. Надёжность: {N}/{N} модульных тестов пройдены 26.10.2026. Это не процент надёжности сервиса или клинической эффективности. key-metrics-unit-2026-10-26.json.
3. Доступ: 401 без сессии, 403 для пациента, 404 для другого врача на API экспорта. Свежий автотест integrations.spec.ts. Не пентест и не сертификация безопасности.
4. Восстановление: {restore} с для тестовой локальной копии. Содержимое {b['criticalTableCount']} таблиц совпало в испытании 24.10.2026. Это снимок той даты; сравнение не включало MedicationSchedule, добавленную 26.10.2026. Не RTO/RPO полной инфраструктуры. backup-verification.json.
5. Извлечение сведений: 6/6 коротких искусственных сценариев совпали с ожидаемыми результатами; для prompt injection корректен отказ от извлечения. Не precision/recall и не клиническая точность. Прогон 24.10.2026, Mistral ministral-14b-latest. extraction-evaluation.json.
6. Расширяемость: новая учебная шкала и версия опубликованы из JSON без изменения расчётного ядра; повтор идемпотентен, перезапись версии запрещена. Проверка 24.10.2026. Новый алгоритм или интеграция с произвольной МИС потребуют разработки. extensibility.json.

Сохраняйте нижние подписи на постере: они определяют смысл чисел. Исходные протоколы — docs/evidence; копии в комплекте. Ключи, резервные копии БД и данные пациентов в комплект не включены.
'''
(OUT/'Данные_и_использование.md').write_text(notes,encoding='utf-8')
for fn in ['key-metrics-unit-2026-10-26.json','key-metrics-access-2026-10-26.json','read-concurrency-1.json','read-concurrency-8.json','read-concurrency-24.json','backup-verification.json','extraction-evaluation.json','extensibility.json']:
 obj=read(fn)
 if fn.startswith('key-metrics-unit'):obj={k:obj[k] for k in ['success','numTotalTests','numPassedTests','numFailedTests']}
 if fn.startswith('key-metrics-access'):obj={'stats':obj['stats'],'test':'integrations.spec.ts','scope':'401 / 403 / 404; synthetic accounts'}
 (OUT/'Протоколы'/fn).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
manifest=dict(panels=6,widthPx=2400,heightPx=1600,dpi=300,p95RoundedMs=p95,unitTests=N,httpRequests=total,httpErrors=0,pdfCount=7);(QA/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
archive=ROOT/'output/Контур_Ключевые_метрики.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for file in sorted(OUT.rglob('*')):
  if file.is_file():z.write(file,Path('Контур_Ключевые_метрики')/file.relative_to(OUT))
print(json.dumps(manifest));print(str(archive))
