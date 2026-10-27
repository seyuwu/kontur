"""Vector poster panels from checked project evidence. No patient data is read."""
import json, math, textwrap, zipfile
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from pypdf import PdfReader, PdfWriter
import pypdfium2 as pdfium
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/poster-metrics'
QA = ROOT / 'tmp/poster-metrics'
for p in [OUT, QA, OUT/'PNG', OUT/'PDF']: p.mkdir(parents=True, exist_ok=True)
FONTROOT = Path('C:/Users/nefon/.agents/skills/canvas-design/canvas-fonts')
for name, path in [('Text','C:/Windows/Fonts/segoeui.ttf'),('Bold','C:/Windows/Fonts/seguisb.ttf'),('Number',str(FONTROOT/'JetBrainsMono-Bold.ttf'))]:
    pdfmetrics.registerFont(TTFont(name,path))
C = dict(ink='#173C34', green='#2D6653', mint='#DDECD9', paper='#F5F7F2', line='#DCE4DB', muted='#607369', amber='#94651E', sand='#F6EEDC', white='#FFFFFF')
def read(path): return json.loads((ROOT/path).read_text(encoding='utf-8'))
unit=read('docs/evidence/unit-tests-2026-10-26.json')
assert unit['success'] and unit['numFailedTests']==0
N=unit['numPassedTests']
loads=[read(f'docs/evidence/read-concurrency-{n}.json') for n in [1,8,24]]
backup=read('docs/evidence/backup-verification.json')
summary=read('docs/evidence/summary-evaluation.json')
extract=read('docs/evidence/extraction-evaluation.json')
assert backup['restore']['contentMatches'] and extract['matchedCases']==6 and summary['completedRequests']==3

class Art:
    def __init__(self,c,H,ox=0,oy=0):self.c,self.H,self.ox,self.oy=c,H,ox,oy
    def child(self,x,y):return Art(self.c,self.H,self.ox+x,self.oy+y)
    def color(self,k):return HexColor(C.get(k,k))
    def text(self,x,y,s,size=12,font='Text',color='ink',align='left'):
        c=self.c;c.setFillColor(self.color(color));c.setFont(font,size)
        fn=c.drawString if align=='left' else c.drawRightString if align=='right' else c.drawCentredString
        fn(self.ox+x,self.H-self.oy-y,s)
    def line(self,x1,y1,x2,y2,color='line',width=1,dash=None):
        c=self.c;c.setStrokeColor(self.color(color));c.setLineWidth(width);c.setDash(dash or [])
        c.line(self.ox+x1,self.H-self.oy-y1,self.ox+x2,self.H-self.oy-y2);c.setDash([])
    def box(self,x,y,w,h,fill='white',stroke=None,r=8):
        c=self.c;c.setFillColor(self.color(fill));c.setStrokeColor(self.color(stroke or fill));c.setLineWidth(.8)
        c.roundRect(self.ox+x,self.H-self.oy-y-h,w,h,r,fill=1,stroke=bool(stroke))
    def circle(self,x,y,r,fill='mint',stroke=None,width=1):
        c=self.c;c.setFillColor(self.color(fill));c.setStrokeColor(self.color(stroke or fill));c.setLineWidth(width)
        c.circle(self.ox+x,self.H-self.oy-y,r,fill=1,stroke=bool(stroke))
    def check(self,x,y,size=10,color='green'):
        self.line(x-size*.45,y,x-size*.1,y+size*.35,color,2);self.line(x-size*.1,y+size*.35,x+size*.5,y-size*.4,color,2)
    def arrow(self,x1,y1,x2,y2,color='green',dash=None):
        self.line(x1,y1,x2,y2,color,1.5,dash)
        t=math.atan2(y2-y1,x2-x1)
        for sign in [-1,1]:self.line(x2,y2,x2-6*math.cos(t+sign*.5),y2-6*math.sin(t+sign*.5),color,1.5)
    def words(self,x,y,s,w,size=12,font='Text',color='muted',leading=None):
        lines=[]
        for raw in s.split('\n'):
            line=''
            for word in raw.split():
                test=(line+' '+word).strip()
                if line and pdfmetrics.stringWidth(test,font,size)>w:lines.append(line);line=word
                else:line=test
            lines.append(line)
        for i,line in enumerate(lines):self.text(x,y+i*(leading or size*1.35),line,size,font,color)
        return y+len(lines)*(leading or size*1.35)
    def doc(self,x,y,w=38,h=47,label=None):
        self.box(x,y,w,h,'white','green',5)
        for i in range(3):self.line(x+8,y+15+i*7,x+w-8,y+15+i*7,'line',2)
        if label:self.text(x+w/2,y+h+17,label,11,'Bold',align='center')
    def person(self,x,y,label=None):
        self.circle(x,y-9,8,'white','green',1.5)
        self.box(x-15,y+4,30,22,'white','green',8)
        if label:self.text(x,y+46,label,11,'Bold',align='center')
    def database(self,x,y,w=50,h=44,label=None):
        self.box(x,y,w,h,'mint','green',6)
        for d in [8,20,32]:self.line(x+5,y+d,x+w-5,y+d,'green',.8)
        if label:self.text(x+w/2,y+h+18,label,11,'Bold',align='center')

TITLES={
'T01':'Быстродействие системы','T02':'Обработка входных данных','T03':'Надёжность и корректность','T04':'Эргономика интерфейса','T05':'Обоснованность выводов','T06':'Устойчивость к нагрузке','T07':'Восстановление данных','T08':'Кроссплатформенность','T09':'Масштабируемость','T10':'Гибкость архитектуры','T11':'Гибкость работы с данными','T12':'Полнота данных','T13':'Защищённость данных',
'G01':'Научная обоснованность','G02':'Клиническая применимость','G03':'Удобство интерфейса','G04':'Обязательные условия','G05':'Функции инструмента','G06':'Апробация инструмента'}
STATUS={
'T01':'Локальный замер','T02':'Учебные примеры','T03':'Автотесты','T04':'Нужна оценка пользователей','T05':'Происхождение проверено','T06':'Локальный замер','T07':'Копия восстановлена','T08':'Адаптивная веб-версия','T09':'Основа подготовлена','T10':'Проверено','T11':'Реализовано','T12':'Реализовано','T13':'Доступ проверен',
'G01':'Учебный контур','G02':'Нужна апробация','G03':'Техническая проверка','G04':'Нужен внешний чек-лист','G05':'Рабочие сценарии','G06':'Техническая апробация'}
FOOT={
'T01':'p95 HTTP · 24 параллельных запроса\nЛокальный замер, 24.10.2026',
'T02':'Синтетические случаи · не клиническая точность',
'T03':f'{N} модульных проверок · 26.10.2026',
'T04':'Время и удобство для врачей ещё не измерены',
'T05':'3 обобщения Mistral на вымышленных данных',
'T06':'540 запросов чтения · 0 HTTP-ошибок',
'T07':f"Сверено содержимое {backup['criticalTableCount']} таблиц · локально",
'T08':'Браузер · реальные устройства ещё не испытаны',
'T09':'Работа нескольких реплик ещё не испытана',
'T10':'Новая учебная шкала · без изменения ядра',
'T11':'Постраничные выборки · история версий',
'T12':'Связаны ответы, назначения и источники',
'T13':'Проверки доступа · пентест ещё не проведён',
'G01':'Цифровой перенос требует клинической проверки',
'G02':'Клиническая эффективность ещё не оценена',
'G03':'Без измерения удовлетворённости пользователей',
'G04':'Полный список условий организатора не получен',
'G05':'Анкеты, назначения, переписка и документы',
'G06':'Апробация с реальными пациентами впереди'}
AMBER={'T04','T09','G02','G04','G06'}

def labelbox(a,x,y,w,text,fill='mint',size=11):
    a.box(x,y,w,28,fill,r=6);a.text(x+w/2,y+18,text,size,'Bold',align='center')

def tile(a,x,y,w,h,id):
    a=a.child(x,y);a.box(0,0,w,h,'white','line',14)
    # Titles share a stable baseline; only exceptional long names wrap.
    a.words(22,35,TITLES[id],w-86,17,'Bold','ink',21)
    a.text(w-20,32,id,10,'Number','muted',align='right')
    color='amber' if id in AMBER else 'green'
    a.circle(26,h-48,3,color);a.text(36,h-44,STATUS[id],10,'Bold',color)
    a.words(22,h-24,FOOT[id],w-42,9.3,'Text','muted',12)
    if id=='T01':
        if w>500:
            a.text(22,133,'≤147',66,'Number');a.text(260,132,'мс',27,'Bold','green')
            a.text(25,161,'p95 · время ответа HTTP',13,color='muted')
            bx=w*.55;bw=w-bx-62
            for j,(label,value) in enumerate([('Список',130.8),('Карточка',146.5),('История',138.6)]):
                yy=87+j*32;a.text(bx,yy,label,11,color='muted');a.box(bx,yy+8,bw,9,'paper',r=4);a.box(bx,yy+8,bw*value/150,9,'green',r=4);a.text(w-18,yy+16,str(value).replace('.',','),10,'Number',align='right')
        else:
            a.text(22,116,'≤147',49,'Number');a.text(223,115,'мс',22,'Bold','green')
            for j,(label,value) in enumerate([('Список',130.8),('Карточка',146.5),('История',138.6)]):
                yy=137+j*17;a.text(22,yy+7,label,10,color='muted');a.box(87,yy,w-152,7,'paper',r=3);a.box(87,yy,(w-152)*value/150,7,'green',r=3);a.text(w-20,yy+7,str(value).replace('.',','),9,'Number',align='right')
    elif id=='T02':
        a.text(22,126,'6/6',49,'Number');a.text(24,151,'учебных случаев',13,color='muted')
        a.doc(w-105,80,38,48);a.circle(w-49,119,15);a.check(w-49,119)
        for i in range(6):a.circle(30+i*23,178,5,'green')
    elif id=='T03':
        a.text(22,123,str(N),49,'Number');a.text(24,149,f'из {N} пройдено',13,color='muted')
        for i in range(N):a.box(w-153+(i%16)*7.5,85+(i//16)*10,4.5,6,'green',r=1.1)
        a.text(w-35,181,'0 сбоев',12,'Bold','green',align='right')
    elif id=='T04':
        for i,(title,person) in enumerate([('Назначить','Врач'),('Заполнить','Пациент'),('Результат','Врач')]):
            xx=54+i*(w-108)/2;a.person(xx,103,person);a.text(xx,173,title,12,'Bold',align='center')
            if i<2:a.arrow(xx+23,106,xx+(w-108)/2-24,106)
    elif id=='T05':
        a.text(22,120,'3/3',49,'Number');a.text(24,146,'со ссылками',13,color='muted')
        for i in range(3):
            xx=w-133+i*38;a.doc(xx,83,28,42);a.circle(xx+14,143,8);a.check(xx+14,143,7)
        a.text(24,179,'Факт',12,'Bold');a.arrow(60,175,100,175);a.text(110,179,'Цитата',12,'Bold');a.arrow(158,175,197,175);a.text(208,179,'Врач',12,'Bold')
    elif id=='T06':
        a.text(22,114,'24',45,'Number');a.words(23,135,'параллельных\nзапроса',115,12)
        gx=167;gy=166;gw=w-gx-22;gh=75
        a.line(gx,gy,gx+gw,gy);a.line(gx,gy,gx,gy-gh)
        vals=[r['endpoints'][1]['p95Ms'] for r in loads]
        for i,v in enumerate(vals):
            xx=gx+i*gw/2;yy=gy-v/160*gh
            if i:a.line(gx+(i-1)*gw/2,gy-vals[i-1]/160*gh,xx,yy,'green',2)
            a.circle(xx,yy,4,'green');a.text(xx,gy+17,str([1,8,24][i]),10,'Number',align='center')
        a.text(gx,80,'p95, мс',10,color='muted');a.text(gx+gw,gy-gh+3,'147',10,'Number','green',align='right')
    elif id=='T07':
        value=f"{backup['restore']['durationMs']/1000:.2f}".replace('.',',')
        a.text(22,123,value,49,'Number');a.text(173,122,'с',27,'Bold','green');a.text(24,150,'тестовое восстановление',12,color='muted')
        a.database(w-92,88,48,43);a.arrow(w-115,103,w-98,103);a.arrow(w-44,146,w-102,146)
        a.check(w-67,166,12)
    elif id=='T08':
        specs=[(36,100,32,55,'320'),(115,89,43,66,'390'),(217,87,94,58,'1440')]
        for x0,y0,ww,hh,label in specs:
            a.box(x0,y0,ww,hh,'paper','green',6);a.box(x0+5,y0+7,ww-10,hh-16,'mint',r=2)
            if ww>60:a.line(x0+ww/2,y0+hh,x0+ww/2,y0+hh+10,'green',2);a.line(x0+ww/2-16,y0+hh+10,x0+ww/2+16,y0+hh+10,'green',2)
            a.text(x0+ww/2,184,label,13,'Number',align='center')
    elif id=='T09':
        a.box(22,91,88,39,'mint','green',7);a.text(66,115,'Web',14,'Bold',align='center')
        a.box(w-121,91,99,39,'mint','green',7);a.text(w-71,115,'Worker',14,'Bold',align='center')
        a.database(w/2-24,142,48,31);a.arrow(81,133,w/2-13,141);a.arrow(w-83,133,w/2+13,141)
        a.text(w/2,191,'PostgreSQL',11,'Bold',align='center')
    elif id=='T10':
        a.doc(24,88,58,58);a.text(53,122,'JSON',13,'Number',align='center')
        a.arrow(96,117,135,117)
        a.box(149,88,w-173,58,'mint',r=10);a.text((149+w-24)/2,123,'Ядро',20,'Bold',align='center')
        a.check(w-45,166,10);a.text(24,180,'Новая шкала → новая версия',12,'Bold')
    elif id=='T11':
        a.database(27,96,47,54)
        for i,label in enumerate(['Поиск','Фильтры','История']):
            yy=83+i*36;a.arrow(88,122,w-155,yy+14);labelbox(a,w-143,yy,118,label)
    elif id=='T12':
        cx=w/2;cy=133
        nodes=[(52,84,'Данные'),(w/2,77,'Анкеты'),(w-52,84,'Ответы'),(52,176,'Лечение'),(w/2,183,'Чат'),(w-52,176,'Источники')]
        for xx,yy,label in nodes:a.line(cx,cy,xx,yy,'line',1.5);a.box(xx-39,yy-12,78,24,'paper',r=5);a.text(xx,yy+4,label,10,'Bold',align='center')
        a.box(cx-45,cy-15,90,30,'mint',r=7);a.text(cx,cy+5,'Пациент',12,'Bold',align='center')
    elif id=='T13':
        sx=65 if w<500 else 100;sy=115
        points=[(sx-29,sy-24),(sx,sy-35),(sx+29,sy-24),(sx+23,sy+13),(sx,sy+34),(sx-23,sy+13)]
        c=a.c;p=c.beginPath();p.moveTo(a.ox+points[0][0],a.H-a.oy-points[0][1])
        for xx,yy in points[1:]:p.lineTo(a.ox+xx,a.H-a.oy-yy)
        p.close();c.setFillColor(a.color('mint'));c.setStrokeColor(a.color('green'));c.drawPath(p,fill=1,stroke=1);a.check(sx,sy,20)
        start=120 if w<500 else 205
        if w>500:
            for i,(code,label) in enumerate([('401','Без входа'),('403','Другая роль'),('404','Чужая карточка')]):
                xx=start+i*153;a.text(xx,118,code,31,'Number','green');a.text(xx,146,label,12,color='muted')
        else:
            for i,(code,label) in enumerate([('401','Без входа'),('403','Другая роль'),('404','Чужая карточка')]):
                yy=90+i*33;a.text(start,yy,code,20,'Number','green');a.text(start+52,yy-2,label,10,color='muted')
        a.text(22,187,'Роль + доступ к карточке',13,'Bold')
    elif id=='G01':
        a.text(22,120,'19',49,'Number');a.text(24,146,'методик в каталоге',12,color='muted');a.doc(w-91,79,48,62,'КР F40')
        labelbox(a,22,158,133,'8 учебных форм')
    elif id=='G02':
        a.person(61,104,'Врач');a.arrow(91,110,139,110);a.doc(154,88,47,45);a.arrow(214,110,w-69,110);a.person(w-44,104,'Пациент')
        a.text(w/2,180,'Решение остаётся за врачом',15,'Bold',align='center')
    elif id=='G03':
        for i,(title,sub) in enumerate([('Врач','Назначения'),('Пациент','Текущие задачи')]):
            xx=22+i*(w-30)/2;ww=(w-58)/2;a.box(xx,85,ww,81,'paper','line',8);a.box(xx+9,95,ww-18,18,'mint',r=4);a.text(xx+ww/2,108,title,11,'Bold',align='center')
            for j in range(2):a.box(xx+10,124+j*20,ww-20,14,'white','line',3)
            a.text(xx+ww/2,184,sub,11,'Bold',align='center')
    elif id=='G04':
        for i,label in enumerate(['Роли и доступ','Подключение пациента','Назначения врача']):a.check(33,88+i*29,10);a.text(53,92+i*29,label,13)
        a.box(22,158,w-44,27,'sand',r=5);a.text(34,176,'Условия организатора: уточнить',11,'Bold','amber')
    elif id=='G05':
        labels=['Анкеты','Лечение','Чат','Документы']
        for i,label in enumerate(labels):
            xx=22+(i%2)*(w-32)/2;yy=83+(i//2)*53;ww=(w-60)/2
            a.box(xx,yy,ww,42,'paper','line',7);a.circle(xx+17,yy+21,8);a.check(xx+17,yy+21,7);a.text(xx+32,yy+25,label,12,'Bold')
    elif id=='G06':
        for row in range(2):
            for col in range(5):a.circle(32+col*25,94+row*27,7,'mint','green')
        a.words(181,99,'Только\nвымышленные\nданные',w-200,17,'Bold','ink',23)
        a.box(22,158,137,26,'sand',r=5);a.text(90,175,'Без реальных пациентов',9,'Bold','amber',align='center')

def make_pdf(path,W,H,draw):
    c=canvas.Canvas(str(path),pagesize=(W,H),pageCompression=1);c.setTitle(path.stem);c.setAuthor('Контур');draw(Art(c,H));c.showPage();c.save()
    r=PdfReader(path);assert len(r.pages)==1
    assert '\ufffd' not in r.pages[0].extract_text()

def render(path,target,scale,alpha=False):
    doc=pdfium.PdfDocument(str(path));page=doc[0]
    image=page.render(scale=scale,fill_color=(255,255,255,0 if alpha else 255)).to_pil()
    image.save(target,dpi=(72*scale,72*scale));page.close();doc.close()

def heading(a,title,sub,H):
    a.box(0,0,1200,H,'paper',r=0)
    a.text(48,60,'КОНТУР',18,'Bold','green');a.text(1152,60,'ПРОВЕРЯЕМЫЕ РЕЗУЛЬТАТЫ',11,'Bold','muted',align='right')
    a.text(48,129,title,45,'Bold');a.text(49,166,sub,15,color='muted')

def technical(a):
    heading(a,'Технические метрики','13 показателей · измерения и устройство системы',1680)
    w=(1200-96-32)/3;h=246;gap=16;top=214
    positions=[('T01',0,0,2),('T02',2,0,1),('T03',0,1,1),('T04',1,1,1),('T05',2,1,1),('T06',0,2,1),('T07',1,2,1),('T08',2,2,1),('T09',0,3,1),('T10',1,3,1),('T11',2,3,1),('T12',0,4,1),('T13',1,4,2)]
    for id,col,row,span in positions:tile(a,48+col*(w+gap),top+row*(h+gap),w*span+gap*(span-1),h,id)
    a.text(48,1560,'Измерено локально на вымышленных данных, 24–26 октября 2026 года.',12,'Bold','green')
    a.words(48,1587,'p95 — 95% измеренных HTTP-запросов укладываются в указанное время. Это не задержка push, не предел числа пользователей и не клиническая валидация.',1090,12)
    a.line(48,1633,1152,1633);a.text(48,1655,'Источники чисел и границы проверок — в файле «Данные и ограничения.md».',10,color='muted')

def general(a):
    heading(a,'Общие критерии','6 критериев · что реализовано и что ещё предстоит проверить',930)
    w=(1200-96-32)/3
    for i in range(6):tile(a,48+(i%3)*(w+16),214+(i//3)*262,w,246,f'G{i+1:02d}')
    a.box(48,772,1104,95,'mint',r=12)
    a.text(72,805,'Техническая проверка выполнена.',22,'Bold','green')
    a.text(72,836,'Клиническая апробация, оценка удобства и приёмка внешних условий — отдельные этапы.',14)
    a.text(48,903,'Контур · учебная версия · 26.10.2026',10,color='muted')

# Individual panels have transparent space outside the rounded white panel.
for id,title in TITLES.items():
    pdf=OUT/'PDF'/f'{id}.pdf';make_pdf(pdf,376,262,lambda a,id=id:tile(a,8,8,360,246,id))
    render(pdf,OUT/'PNG'/f'{id}.png',300/72,True)
for name,H,draw in [('01_Технические_метрики',1680,technical),('02_Общие_критерии',930,general)]:
    path=OUT/f'{name}.pdf';make_pdf(path,1200,H,draw);render(path,OUT/f'{name}.png',2.5)
    render(path,QA/f'{name}_review.png',.9)
writer=PdfWriter()
for name in ['01_Технические_метрики','02_Общие_критерии']:writer.add_page(PdfReader(OUT/f'{name}.pdf').pages[0])
with (OUT/'Контур_Инфографика_для_постера.pdf').open('wb') as f:writer.write(f)

# A review contact sheet keeps individual-panel details inspectable.
for group in [list(TITLES)[:10],list(TITLES)[10:]]:
    canvas_img=Image.new('RGB',(1128,math.ceil(len(group)/3)*262),'#E8EEE7')
    for i,id in enumerate(group):
        im=Image.open(OUT/'PNG'/f'{id}.png');im.thumbnail((376,262));canvas_img.paste(im,((i%3)*376,(i//3)*262),im if im.mode=='RGBA' else None)
    canvas_img.save(QA/f'contact-{group[0]}.png')

philosophy='''# Проверяемый ритм

Смысл передаётся отношениями форм: короткая цепочка показывает действие, узел — связь, повторяющаяся отметка — наблюдение. Тщательно выверенная геометрия делает сложное обозримым без сопровождающих абзацев. Это графическая система, собранная с ремесленной точностью.

Пространство удерживает внимание на доказательстве. Крупный знак соседствует с тихой подписью, но не спорит с ней. Каждая линия и интервал подчинены общей мере; мастерство проявляется в согласованности, а не в количестве украшений.

Тёмная зелень несёт контраст, светлая бумага даёт воздух. Янтарь обозначает незавершённую проверку, не имитируя тревогу. Цвет сообщает статус и никогда не превращает неподтверждённое предположение в достижение.

Типографика различает измерение и интерпретацию. Число весомо и отчётливо, подпись коротка, оговорка остаётся читаемой. Результат требует кропотливого внимания к краям, ширинам и ритму — как у аккуратно собранного измерительного инструмента.
'''
(OUT/'Визуальный_принцип.md').write_text(philosophy,encoding='utf-8')

notes=f'''# Данные и ограничения

Материалы для постера проекта «Контур». Подготовлено 26 октября 2026 года. Это результаты технических испытаний учебной версии на синтетических данных, не клиническая валидация.

## Как использовать

- PNG/ содержит 19 отдельных панелей 1567 × 1092 px (300 dpi), с прозрачностью за пределами закруглённой карточки. T01–T13 — технические метрики; G01–G06 — общие критерии.
- PDF/ — те же панели как векторные страницы. Их можно масштабировать для печати без потери чёткости текста и линий.
- Два общих листа доступны отдельно в PNG (3000 px по ширине) и PDF. Общий двухстраничный PDF объединяет оба листа.
- Основные числа можно вынести на постер, но нужно сохранить подписи о локальном замере, синтетических данных и неподтверждённых этапах.

## Проверяемые значения

| Код | Основание |
|---|---|
| T01 | p95 списка 130,8 мс, карточки 146,5 мс, истории 138,6 мс при 24 параллельных запросах. Округление верхнего значения вверх до 147 мс. Протокол docs/evidence/read-concurrency-24.json, 24.10.2026. |
| T02 | 6 из 6 коротких синтетических сценариев извлечения. Это не precision, recall или клиническая точность. docs/evidence/extraction-evaluation.json, 24.10.2026. |
| T03 | {N} из {N} модульных тестов, ошибок 0. Прогон выполнен заново 26.10.2026: docs/evidence/unit-tests-2026-10-26.json. |
| T04 | Показана последовательность действий, а не число кликов. Время выполнения и удобство с пользователями не измерены. |
| T05 | 3 из 3 реальных обобщений Mistral с проверенными ссылками на исходные фрагменты, на вымышленных данных. Проверка происхождения не доказывает клиническую корректность. docs/evidence/summary-evaluation.json, 26.10.2026 по Москве. |
| T06 | 180 запросов на каждый уровень параллельности 1/8/24, всего 540; HTTP-ошибок 0. p95 карточки: 7,7 / 56,6 / 146,5 мс. Данные 120 вымышленных пациентов и 4200 записей. Это не предел пользователей и не длительный нагрузочный тест. |
| T07 | Тестовое восстановление отдельной локальной БД за {backup['restore']['durationMs']/1000:.3f} с; количества и содержимое 36 таблиц совпали. Не включает развёртывание инфраструктуры и не устанавливает RTO/RPO. docs/evidence/backup-verification.json, 24.10.2026. |
| T08 | Проверялись ширины браузера 320/390/1440 px. Это не испытание каждого устройства или операционной системы. |
| T09 | Отдельные процессы веб-части и Graphile Worker, общая PostgreSQL. Работа кластера и предел мощности не проверены. |
| T10 | Новая учебная шкала опубликована из JSON, повтор идемпотентен, перезапись версии запрещена; расчётное ядро не менялось. docs/evidence/extensibility.json. Новый алгоритм или коннектор конкретной МИС требует разработки. |
| T11 | Поиск, фильтры, постраничное чтение и история версий реализованы. Скорость произвольных запросов и произвольное расширение без миграций не заявляются. |
| T12 | Диаграмма отражает связанные сущности приложения, а не процент полноты медицинской информации. |
| T13 | Проверки доступа на интерфейсе экспорта: 401 без сессии, 403 для пациента, 404 для чужого врача. Это не пентест и не сертификация безопасности. |
| G01 | В каталоге 19 методик из предоставленных рекомендаций; 8 учебных форм относятся к 7 методикам (ИТТ разделена на две формы). Не все 19 методик доступны для цифрового заполнения. |
| G02–G03 | Реализованный сценарий и техническая проверка интерфейса не заменяют оценку клинической пользы или удобства с пользователями. |
| G04 | Внешний список обязательных условий организатора в предоставленном слайде отсутствует. Соответствие всем условиям не заявляется. |
| G05 | Рабочие функции показаны пиктограммами; текущие сценарии назначения, ответа и рекомендации врачу проверены. |
| G06 | Технические испытания выполнялись на вымышленных данных. Апробация на реальных пациентах не проводилась. |

## Панели

'''+ '\n'.join(f'- {id}: {title}' for id,title in TITLES.items())+'\n'
(OUT/'Данные_и_ограничения.md').write_text(notes,encoding='utf-8')
manifest={'panels':len(TITLES),'pdfFiles':len(list(OUT.rglob('*.pdf'))),'pngFiles':len(list(OUT.rglob('*.png'))),'unitTests':N,'sources':'docs/evidence','prepared':'2026-10-26'}
(QA/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest))
