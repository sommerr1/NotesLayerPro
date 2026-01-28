# C4 Diagram: Notes Layer Pro - Container Diagram

```mermaid
C4Container
    title Container diagram for Notes Layer Pro

    Person(user, "Пользователь", "Создает заметки на веб-страницах, использует AI для уточнений")

    System_Boundary(extension, "Notes Layer Pro Extension") {
        Container(background, "Background Service Worker", "JavaScript", "Обрабатывает сообщения, управляет БД, координирует AI запросы")
        Container(content, "Content Scripts", "JavaScript", "Инжектируется в веб-страницы, создает заметки, выделяет текст")
        Container(popup, "Popup UI", "HTML/JavaScript", "Интерфейс для просмотра всех заметок, поиска и экспорта")
        ContainerDb(indexeddb, "IndexedDB", "Browser Database", "Хранит страницы, якоря и заметки локально")
        Container(notecard, "Note Card UI", "HTML/JavaScript", "Компонент для отображения и редактирования заметок на странице")
    }

    System_Ext(google, "Google Search (AI)", "Внешний сервис для получения AI ответов через Gemini")

    Rel(user, background, "Использует", "Chrome Extension API")
    Rel(user, content, "Взаимодействует", "На веб-страницах")
    Rel(user, popup, "Открывает", "Иконка расширения")
    Rel(user, notecard, "Редактирует", "На странице")

    Rel(background, indexeddb, "Читает/Записывает", "Chrome Storage API")
    Rel(content, background, "Отправляет сообщения", "Chrome Runtime API")
    Rel(popup, background, "Отправляет сообщения", "Chrome Runtime API")
    Rel(notecard, background, "Отправляет сообщения", "Chrome Runtime API")
    Rel(content, notecard, "Создает и управляет", "DOM API")

    Rel(background, google, "Запрашивает AI ответы", "HTTPS/Google Search API")
```

## Описание контейнеров

### Background Service Worker
- **Технология**: JavaScript (ES6 Modules)
- **Ответственность**: 
  - Обработка сообщений от content scripts и popup
  - Управление IndexedDB через db.js
  - Координация AI запросов через GoogleSearchProvider
  - Управление контекстным меню
  - Экспорт данных в JSON

### Content Scripts
- **Технология**: JavaScript (ES6 Modules)
- **Ответственность**:
  - Инициализация на веб-страницах
  - Создание заметок из выделенного текста
  - Восстановление заметок при загрузке страницы
  - Управление выделениями текста (Highlighter)
  - Создание якорей для заметок (AnchorManager)
  - Отображение превью заметок при наведении

### Popup UI
- **Технология**: HTML/CSS/JavaScript
- **Ответственность**:
  - Отображение списка всех страниц с заметками
  - Поиск по заметкам
  - Удаление страниц и заметок
  - Экспорт данных в JSON
  - Перезагрузка расширения

### IndexedDB
- **Технология**: Browser IndexedDB API
- **Ответственность**:
  - Хранение страниц (pages)
  - Хранение якорей (anchors)
  - Хранение заметок (notes)
  - Поддержка индексов для быстрого поиска

### Note Card UI
- **Технология**: HTML/CSS/JavaScript (Quill Editor)
- **Ответственность**:
  - Отображение карточки заметки на странице
  - Редактирование заметок (аннотации, вопросы)
  - Запрос AI ответов
  - Удаление заметок
  - Перепривязка заметок к новому тексту

### Google Search (AI)
- **Технология**: Внешний веб-сервис
- **Ответственность**:
  - Предоставление AI ответов через Gemini
  - Обработка вопросов пользователя

## Технологии

- **Frontend**: Vanilla JavaScript (ES6 Modules), HTML5, CSS3
- **Database**: IndexedDB (Browser API)
- **Editor**: Quill.js (Rich Text Editor)
- **Extension API**: Chrome Extensions Manifest V3
- **AI Integration**: Google Search AI (Gemini) через веб-скрапинг
