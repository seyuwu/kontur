import json, re, shutil, zipfile, html
from pathlib import Path
from datetime import datetime
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Flowable, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader, PdfWriter

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/evaluation'
QA=ROOT/'tmp/pdfs/evaluation'
OUT.mkdir(parents=True,exist_ok=True);QA.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Body','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('BodyBold','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='BodyBold',italic='Body',boldItalic='BodyBold')
styles={
 'title':ParagraphStyle('title',fontName='BodyBold',fontSize=20,leading=24,textColor=colors.black,spaceAfter=12),
 'body':ParagraphStyle('body',fontName='Body',fontSize=10.1,leading=14.2,textColor=colors.black,spaceAfter=9),
 'heading':ParagraphStyle('heading',fontName='BodyBold',fontSize=11,leading=15,textColor=colors.black,spaceBefore=7,spaceAfter=5,keepWithNext=True),
 'small':ParagraphStyle('small',fontName='Body',fontSize=8.4,leading=11.4,textColor=colors.HexColor('#46534c'),spaceAfter=5),
 'meta':ParagraphStyle('meta',fontName='BodyBold',fontSize=9,leading=12,textColor=colors.HexColor('#2d604b'),spaceAfter=8),
 'table':ParagraphStyle('table',fontName='Body',fontSize=8.8,leading=11.8,textColor=colors.black),
}
def load(name):return json.loads((ROOT/name).read_text(encoding='utf-8'))
items=load('docs/metrics/catalogue.json')
unit=load('docs/evidence/unit-tests.json');e2e=load('docs/evidence/e2e-metrics.json')
backup=load('docs/evidence/backup-verification.json');ext=load('docs/evidence/extensibility.json')
arch=load('docs/evidence/architecture.json');extract=load('docs/evidence/extraction-evaluation.json');summary=load('docs/evidence/summary-evaluation.json')
loads=[load(f'docs/evidence/read-concurrency-{level}.json') for level in [1,8,24]]
assert unit['success'] and e2e['status']=='passed' and backup['restore']['contentMatches'] and ext['coreUnchanged'] and not arch['violations']
def P(text,kind='body'):return Paragraph(html.escape(str(text)).replace('\n','<br/>'),styles[kind])
def footer(c,doc):
 c.setFont('Body',8);c.setFillColor(colors.HexColor('#647168'));c.drawString(48,25,'Контур   Учебный контур   24 октября 2026');c.drawRightString(A4[0]-48,25,str(doc.page))
def build(path,story):
 doc=SimpleDocTemplate(str(path),pagesize=A4,rightMargin=48,leftMargin=48,topMargin=42,bottomMargin=44,title=path.stem,author='Контур')
 doc.build(story,onFirstPage=footer,onLaterPages=footer)
 return len(PdfReader(path).pages)
def heading(text):return P(text,'heading')
def metric_facts(id):
 if id in ['T01','T06']:
  rows=[['Параллельность','Список p95 мс','Карточка p95 мс','История p95 мс']]
  for r in loads:rows.append([str(r['concurrency'])]+[str(v['p95Ms']).replace('.',',') for v in r['endpoints']])
  table=Table([[P(c,'table') for c in row] for row in rows],colWidths=[104,132,132,131])
  table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eaf0e9')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#dce3db'))]))
  return [table,Spacer(1,7),P('По 180 запросов на уровень, всего 540. 120 вымышленных карточек, 4200 записей истории. HTTP ошибок: '+str(sum(r['errors'] for r in loads))+'.','small')]
 if id=='T02':return [P(f"Фактический протокол: {extract['matchedCases']} из {extract['plannedCases']} учебных случаев соответствовали проверяемому ожиданию. Это доля успешных сценариев, а не клиническая точность.")]
 if id=='T03':return [P(f"В итоговом прогоне: {unit['numPassedTests']} из {unit['numTotalTests']} модульных проверок; {sum(t['status']=='passed' for t in e2e['tests'])} из {len(e2e['tests'])} выбранных сквозных сценариев. Неуспешных проверок в этих протоколах нет.")]
 if id=='T05':return [P(f"Реальный Mistral: {summary['completedRequests']} из {summary['plannedRequests']} учебных запросов завершились проверяемым результатом. Смысловую клиническую корректность это не устанавливает.")]
 if id=='T07':return [P(f"Последний прогон: создание копии {backup['backupDurationMs']/1000:.3f} с; тестовое восстановление {backup['restore']['durationMs']/1000:.3f} с. Сверены количества и содержимое {backup['criticalTableCount']} таблиц приложения. Измерение не включает время аварийного развёртывания серверов.")]
 if id=='T10':return [P(f"Публикация новой шкалы, повтор, запрет перезаписи и новая версия проверены. Расчётное ядро не изменялось. В статическом графе проверено {arch['clientEntries']} клиентских входов, запрещённых зависимостей не найдено.")]
 if id=='T13':return [P('Интерфейс экспорта проверен на 401 без сессии, 403 для пациента и 404 для чужого врача. Это результат теста конкретного интерфейса, а не оценка всей системы по шкале безопасности.')]
 return []

md_dir=OUT/'Исходники';md_dir.mkdir(exist_ok=True)
individual=[]
for item in items:
 category=('Техническая метрика ' if item['id'].startswith('T') else 'Общий критерий ')+str(int(item['id'][1:]))
 story=[P(category,'meta'),P(item['title'],'title'),P(item['status'],'meta'),P(item['intro'])]
 for title,key in [('Реализация и проверка','implementation'),('Как оценивать','measurement')]:story.extend([heading(title),P(item[key])])
 facts=metric_facts(item['id'])
 if facts:story.extend([heading('Фактический результат')]+facts)
 story.extend([heading('Границы подтверждения'),P(item['limits']),heading('Для презентации'),P(item['speech']),heading('Основания')])
 for ref in item['refs']:
  if ref.startswith('https://'):story.append(Paragraph(f'<link href="{html.escape(ref)}" color="#2d604b">{html.escape(ref)}</link>',styles['small']))
  else:story.append(P(ref,'small'))
 path=OUT/f"{item['id']}_{item['title'].replace(' ','_')}.pdf"
 pages=build(path,story);individual.append((item,path,pages))
 text=f"# {item['title']}\n\n{category}. {item['status']}. Проверка 24 октября 2026 года.\n\n{item['intro']}\n"
 for title,key in [('Реализация и проверка','implementation'),('Как оценивать','measurement'),('Границы подтверждения','limits'),('Для презентации','speech')]:text+=f"\n## {title}\n\n{item[key]}\n"
 text+='\n## Основания\n\n'+'\n'.join('- '+ref for ref in item['refs'])+'\n\nФактические измерения доступны в JSON протоколах папки evidence и PDF версии документа.\n'
 (md_dir/f"{item['id']}_{item['title'].replace(' ','_')}.md").write_text(text,encoding='utf-8')

class Architecture(Flowable):
 def __init__(self):Flowable.__init__(self);self.width=499;self.height=190
 def draw(self):
  c=self.canv
  boxes=[(0,155,499,28,'Кабинеты врача и пациента'),(0,112,499,28,'Защищённые HTTP интерфейсы и контракты'),(0,69,499,28,'Анкеты   Планы   Документы   События'),(0,26,241,28,'PostgreSQL и версии данных'),(258,26,241,28,'Отдельный фоновый процесс')]
  for x,y,w,h,label in boxes:
   c.setFillColor(colors.HexColor('#eef2ec'));c.setStrokeColor(colors.HexColor('#bccbbb'));c.roundRect(x,y,w,h,5,fill=1,stroke=1);c.setFillColor(colors.black);c.setFont('Body',10);c.drawCentredString(x+w/2,y+10,label)
  c.setStrokeColor(colors.HexColor('#2d604b'))
  for x,y1,y2 in [(249,155,140),(249,112,97),(120,69,54),(378,69,54)]:c.line(x,y1,x,y2);c.line(x,y2,x-3,y2+4);c.line(x,y2,x+3,y2+4)
  c.setFont('Body',8.5);c.setFillColor(colors.HexColor('#46534c'));c.drawCentredString(249,6,'Внешние форматы JSON и CSV   Облачная LLM   Push и email')
architecture_path=OUT/'00_Архитектура_и_расширение.pdf'
architecture_story=[P('Техническое устройство','meta'),P('Архитектура и расширение Контура','title'),P('Модульный монолит с отдельным фоновым процессом. Расширяемость подтверждена конкретными изменениями и тестами; полная независимость модулей и готовность к любой нагрузке не заявляются.'),Architecture(),heading('Что уже отделено'),P('Расчёт шкал не зависит от базы, HTTP и LLM. Определения анкет версионируются. Новый учебный JSON опубликован без изменения ядра. Экспорт 1.0 отделяет внутреннюю модель от JSON и CSV. Веб-часть и фоновые задания запускаются раздельно.'),heading('Проверяемость и защита'),P(f"Проверка импортов охватывает {arch['sourceFiles']} исходных файлов и {arch['clientEntries']} клиентских входа. Запрещённые серверные зависимости в клиентском графе не найдены. Доступ к выгрузке проверяется по роли и владельцу карточки; экспорт учитывается в аудите."),heading('Что требует отдельной разработки'),P('Новый алгоритм расчёта, несовместимый внешний контракт, сервисная авторизация и коннектор конкретной МИС требуют разработки. Есть общая PostgreSQL и локальное состояние ограничителя обобщений. Нужны отдельные испытания нескольких реплик, целевой инфраструктуры и глобальных лимитов.'),heading('Для презентации'),P('Мы построили модульную архитектуру с версионными контрактами. Поддерживаемые шкалы и внешние форматы расширяются локально, без переписывания расчётного ядра; границы этой гибкости подтверждены тестами и явно описаны.'),heading('Основания'),P('docs/architecture.md   docs/integrations-v1.md','small'),P('docs/evidence/architecture.json   docs/evidence/extensibility.json','small')]
architecture_pages=build(architecture_path,architecture_story)
shutil.copyfile(ROOT/'docs/architecture.md',md_dir/'00_Архитектура_и_расширение.md')

cover=QA/'cover.pdf'
cover_story=[P('Материалы для оценки проекта','meta'),P('Контур\nМетрики и архитектура','title'),P('Отдельные документы по 13 техническим метрикам и 6 общим критериям со слайда оценки. Дополнительно описаны устройство и границы расширения приложения.'),P('Учебный контур   Вымышленные данные   24 октября 2026','meta'),P(f"Подтверждения: {unit['numPassedTests']} модульных тестов, {len(e2e['tests'])} выбранных сквозных сценариев, 540 запросов чтения без HTTP ошибок, проверка восстановления {backup['criticalTableCount']} таблиц и публикация новой учебной шкалы без изменения ядра."),heading('Как читать пакет'),P('Реализованное отделено от измеренного и от предстоящей клинической проверки. Здесь нет утверждений о проведённом исследовании на пациентах, полной нормативной сертификации или совместимости с любой МИС. JSON протоколы приложены без ключей и медицинских данных.'),Spacer(1,5)]
index=[['Раздел','Документ'],['00','Архитектура и расширение Контура']]+[[it['id'],it['title']] for it in items]
table=Table([[P(c,'table') for c in row] for row in index],colWidths=[48,451]);table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eaf0e9')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#dce3db'))]));cover_story.append(table)
cover_pages=build(cover,cover_story)
writer=PdfWriter()
for path in [cover,architecture_path]+[p for _,p,_ in individual]:writer.append(str(path),import_outline=False)
combined=OUT/'Контур_Метрики_и_архитектура.pdf'
with combined.open('wb') as f:writer.write(f)

evidence=OUT/'evidence';evidence.mkdir(exist_ok=True)
for name in ['architecture.json','extensibility.json','backup-verification.json','e2e-metrics.json','unit-tests.json','extraction-evaluation.json','summary-evaluation.json','read-concurrency-1.json','read-concurrency-8.json','read-concurrency-24.json']:shutil.copyfile(ROOT/'docs/evidence'/name,evidence/name)
readme='''# Контур Метрики и архитектура

Откройте Контур_Метрики_и_архитектура.pdf для последовательного чтения.
Отдельно доступны 13 технических метрик, 6 общих критериев и архитектура.
Редактируемый текст находится в папке Исходники, протоколы — в evidence.

Проверено на локальном учебном стенде. Данные вымышленные. Транспорт push в автоматических сценариях подменён; реальный показ на устройствах проверяется отдельно. Это не клиническая или юридическая сертификация.

В проект добавлены версия 1.0 экспорта JSON/CSV, проверка границ импортов, команда публикации учебной шкалы и сверка содержимого всех таблиц при восстановлении копии. Подробные инструкции: docs/architecture.md и docs/integrations-v1.md в исходном проекте.
'''
(OUT/'README.md').write_text(readme,encoding='utf-8')
manifest={'date':'2026-10-24','individualDocuments':20,'pdfFiles':21,'combinedPages':len(PdfReader(combined).pages),'coverPages':cover_pages,'architecturePages':architecture_pages,'metrics':[{'id':it['id'],'file':p.name,'pages':n} for it,p,n in individual]}
(QA/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False))
