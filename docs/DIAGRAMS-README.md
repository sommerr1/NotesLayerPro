# Диаграммы проекта Notes Layer Pro

Этот каталог содержит диаграммы архитектуры проекта Notes Layer Pro в формате PlantUML.

## Список диаграмм

### 1. C4 Container Diagram (`C4-Container-Diagram.puml`)
**Диаграмма контейнеров** - показывает высокоуровневую архитектуру системы с основными контейнерами и их взаимодействием.

**Контейнеры:**
- Background Service Worker - обработка сообщений и координация
- Content Scripts - инжекция в веб-страницы
- Popup UI - интерфейс расширения
- IndexedDB - локальное хранилище
- Note Card UI - компонент заметки
- Google Search (AI) - внешний сервис

### 2. C4 Component Diagram - Background (`C4-Component-Diagram.puml`)
**Диаграмма компонентов Background Service Worker** - детализирует внутреннюю структуру background worker.

**Компоненты:**
- `background.js` - главный обработчик
- `db.js` - работа с IndexedDB
- `llm-provider.js` - абстракция LLM
- `google-search-provider.js` - провайдер Google Search

### 3. C4 Component Diagram - Content (`C4-Component-Diagram-Content.puml`)
**Диаграмма компонентов Content Scripts** - детализирует структуру content scripts.

**Компоненты:**
- `content.js` - главный модуль
- `anchor.js` - AnchorManager
- `highlighter.js` - Highlighter
- `note-card.js` - NoteCard

### 4. Sequence Diagram - Create Note (`Sequence-CreateNote.puml`)
**Диаграмма последовательности создания заметки** - показывает процесс создания заметки из выделенного текста.

**Основные шаги:**
1. Пользователь выделяет текст
2. Создание якоря (anchor)
3. Сохранение в БД
4. Выделение текста на странице
5. Отображение карточки заметки

### 5. Sequence Diagram - Ask AI (`Sequence-AskAI.puml`)
**Диаграмма последовательности запроса AI ответа** - показывает процесс получения AI ответа через Google Search.

**Основные шаги:**
1. Пользователь задает вопрос
2. Background worker создает вкладку Google Search
3. Извлечение AI ответа
4. Сохранение ответа в заметку
5. Отображение ответа в карточке

### 6. Sequence Diagram - Restore Notes (`Sequence-RestoreNotes.puml`)
**Диаграмма последовательности восстановления заметок** - показывает процесс восстановления заметок при загрузке страницы.

**Основные шаги:**
1. Загрузка страницы
2. Получение информации о странице
3. Загрузка заметок и якорей из БД
4. Восстановление выделений на странице

## Как использовать

### Просмотр диаграмм

#### Онлайн
1. Откройте [PlantUML Online Server](http://www.plantuml.com/plantuml/uml/)
2. Скопируйте содержимое `.puml` файла
3. Вставьте в редактор
4. Диаграмма отобразится автоматически

#### VS Code
1. Установите расширение "PlantUML" (jebbs.plantuml)
2. Откройте `.puml` файл
3. Нажмите `Alt+D` для предпросмотра

#### IntelliJ IDEA / WebStorm
1. Установите плагин "PlantUML integration"
2. Откройте `.puml` файл
3. Диаграмма отобразится автоматически

#### Генерация изображений
```bash
# Установите PlantUML
# Windows (Chocolatey)
choco install plantuml

# macOS (Homebrew)
brew install plantuml

# Linux
sudo apt-get install plantuml

# Генерация PNG
plantuml C4-Container-Diagram.puml

# Генерация SVG
plantuml -tsvg C4-Container-Diagram.puml

# Генерация всех диаграмм
plantuml *.puml
```

### Интеграция в документацию

#### Markdown (GitHub/GitLab)
```markdown
![Container Diagram](C4-Container-Diagram.png)
```

#### Confluence
1. Установите плагин "PlantUML for Confluence"
2. Вставьте содержимое `.puml` файла в блок кода с типом `plantuml`

#### Notion
1. Используйте внешний сервис для генерации изображений
2. Вставьте изображение в Notion

## Структура проекта

```
Notes Layer Pro/
├── background/
│   ├── background.js          # Главный обработчик
│   ├── db.js                  # Работа с IndexedDB
│   ├── llm-provider.js        # Абстракция LLM
│   └── google-search-provider.js  # Google Search провайдер
├── content/
│   ├── content.js            # Главный content script
│   ├── anchor.js             # AnchorManager
│   ├── highlighter.js        # Highlighter
│   └── note-card.js          # NoteCard компонент
├── popup/
│   ├── popup.html            # HTML интерфейс
│   └── popup.js              # Логика popup
└── ui/
    └── note-card.html        # Шаблон карточки заметки
```

## Технологии

- **Frontend**: Vanilla JavaScript (ES6 Modules), HTML5, CSS3
- **Database**: IndexedDB (Browser API)
- **Editor**: Quill.js (Rich Text Editor)
- **Extension API**: Chrome Extensions Manifest V3
- **AI Integration**: Google Search AI (Gemini) через веб-скрапинг
- **Diagramming**: PlantUML (C4 Model)

## Дополнительные ресурсы

- [C4 Model](https://c4model.com/) - методология моделирования архитектуры
- [PlantUML C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML) - библиотека для C4 диаграмм
- [PlantUML Documentation](https://plantuml.com/) - официальная документация
