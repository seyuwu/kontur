"""Reproducible text transcription of the user-supplied F40 PDF; no LLM."""
from pathlib import Path
import re, json, hashlib
from pypdf import PdfReader
source=Path('resources/clinical/f40-455-2024.pdf')
reader=PdfReader(source)
pages=[]
for page in reader.pages:
 text=page.extract_text() or ''
 text=re.sub(r'КонсультантПлюс\s*надежная правовая поддержка[\s\S]*?\(одобрены Минздравом России\)', '', text)
 pages.append(text)
text='\n'.join(pages)
sections={}
for n in range(1,20):
 m=re.search(r'Приложение Г'+str(n)+r'\s*\n',text)
 assert m,n
 end=re.search(r'Приложение Г'+str(n+1)+r'\s*\n',text[m.end():]) if n<19 else None
 sections[n]=text[m.start():m.end()+end.start() if end else len(text)]
def numbered(n, count, start='Содержание (шаблон)', stop='Ключ (интерпретация)'):
 body=sections[n].split(start,1)[1].split(stop,1)[0]
 if n==6: body=body[re.search(r'^1\. Затруднение',body,re.M).start():]
 if n==17: body=body[re.search(r'^1 Меня',body,re.M).start():]
 if n==18: body=body[re.search(r'^1 Когда',body,re.M).start():]
 found=list(re.finditer(r'^\s*(\d+)\.?\s+([^\n]+)',body,re.M))
 out=[]
 for i in range(1,count+1):
  match=next((m for m in found if int(m[1])==i and not re.fullmatch(r'[\d\s.=-]+',m[2])),None)
  assert match,(n,i)
  following=next((m for m in found if m.start()>match.start() and int(m[1])==i+1),None)
  chunk=body[match.start():following.start() if following else len(body)]
  chunk=re.sub(r'^\s*\d+\.?\s+', '', chunk)
  chunk=re.sub(r'\b0\s+1\s+2\s+3\s+4\b','',chunk)
  chunk=re.sub(r'\b1\s+2\s+3\s+4(?:\s+5)?\b','',chunk)
  chunk=chunk.split('Сумма')[0]
  out.append(' '.join(chunk.split()))
 return out
questions={ 'scl':numbered(2,90), 'spras':numbered(6,35), 'bfne':numbered(17,12), 'gelo':numbered(18,15) }
# HAM-A is clinician-rated; retain full symptom descriptions, remove answer repetitions.
body=sections[1].split('Содержание (шаблон)',1)[1].split('Ключ (интерпретация)',1)[0]
questions['ham']=[]
for i in range(1,15):
 match=re.search(r'^'+str(i)+r'\.\s+(?!В (?:слабой|умеренной|тяжелой|очень))',body,re.M); assert match,i
 end=re.search(r'^0\.\s+',body[match.end():],re.M); assert end,i
 questions['ham'].append(' '.join(body[match.end():match.end()+end.start()].split()))
names=['Шкала тревоги Гамильтона (HAM-A)','Опросник SCL-90-R','Интегративный тест тревожности (ИТТ)','Спилбергер—Ханин (STAI)','Шкала тревоги Бека (BAI)','Шкала тревоги Шихана (SPRAS)','Миннесотский многофакторный личностный опросник (MMPI)','Я-структурный тест Аммона','Уровень субъективного контроля (УСК)','Опросник личностных убеждений','Индекс жизненного стиля (LSI)','Стратегии совладающего поведения Лазаруса','Мельбурнский опросник принятия решений','Опросник невротической личности KON-2006','Оценка приверженности лечению (КОП-25)','Шкала социальной тревожности Либовица (LSAS)','Краткая шкала страха негативной оценки','Опросник гелотофобии (GELOPH-15)','Шкала общего клинического впечатления (CGI)']
codes={1:['guideline-f40-ham-demo'],2:['guideline-f40-scl-demo'],3:['guideline-f40-itt-state-demo','guideline-f40-itt-trait-demo'],5:['guideline-f40-bai-demo'],6:['guideline-f40-spras-demo'],17:['guideline-f40-bfne-demo'],18:['guideline-f40-gelo-demo']}
issues={4:'В ключе PDF прямые и обратные пункты 13/15 и 24/26/33/34 расходятся с формулировками утверждений. Автоматический расчёт заблокирован до сверки ключа специалистом.',16:'PDF противоречив: описание задаёт ответы 0–3, бланк 1–4; пороги 55–65, 65–80 и 80–95 пересекаются. Нужна согласованная версия бланка и ключа.',19:'В бланке пропущен вариант 1 для тяжести; описание и ключ индекса эффективности расходятся (матрица 1–16 и диапазон 0–4). Суммировать CGI нельзя. Нужна сверка врачебного бланка.'}
catalog=[]
for n,name in enumerate(names,1):
 pp=[i+1 for i,t in enumerate(pages) if any(part in t for part in [sections[n][:80]])]
 # Determine the inclusive appendix range using original page text markers.
 start=next(i for i,t in enumerate(pages) if re.search(r'Приложение Г'+str(n)+r'\s*\n',t))
 end=next((i for i in range(start,len(pages)) if n<19 and re.search(r'Приложение Г'+str(n+1)+r'\s*\n',pages[i])),len(pages)-1)
 catalog.append({'appendix':n,'title':name,'pages':list(range(start+1,end+2)), 'codes':codes.get(n,[]), 'status':'AVAILABLE' if n in codes else 'SOURCE_CONFLICT' if n in issues else 'REFERENCE_ONLY', 'respondent':'DOCTOR' if n in [1,19] else 'PATIENT', 'limitation':issues.get(n,'В PDF есть описание, но нет полного бланка и/или ключей и нормативных таблиц. Для цифрового заполнения нужно руководство методики.' if n not in codes else ('Доступен учебный расчёт сырых сумм; нормативы и взвешенные подшкалы ИТТ требуют отдельной сверки таблиц.' if n==3 else 'Учебный перенос. Результат проверяет врач.')), 'sourceText':sections[n].strip()})
out=Path('src/modules/clinical');
(out/'f40-questions.json').write_text(json.dumps(questions,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(out/'f40-catalogue.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Source SHA256:',hashlib.sha256(source.read_bytes()).hexdigest())
for key,items in questions.items(): print(key,len(items),items[-1][:130])
