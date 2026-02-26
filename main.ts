import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, TFile, TFolder, normalizePath, AbstractInputSuggest, TextComponent, TAbstractFile } from 'obsidian';

// Plugin settings
interface AddBookSettings {
  templatePath: string;
  saveFolder: string;
  openAfterCreate: boolean;
}

const DEFAULT_SETTINGS: AddBookSettings = {
  templatePath: '',
  saveFolder: '',
  openAfterCreate: true
};

interface BookData {
  title: string;
  author: string;
  pages: string;
  cover: string;
  publisher?: string;
  translator?: string;
  datepublished?: string;
  language?: string;
  isbn?: string;
  url?: string;
  description?: string;
  summary?: string;
}

export default class AddBookPlugin extends Plugin {
  settings: AddBookSettings;

  async onload() {
    await this.loadSettings();

    // Add ribbon icon
    const ribbonIconEl = this.addRibbonIcon('book-down', 'Add book from link.', (_evt: MouseEvent) => {
      void this.addBook();
    });
    ribbonIconEl.addClass('add-book-plugin-ribbon-class');

    // Add command to run the plugin
    this.addCommand({
      id: 'add-book-from-url',
      name: 'Add book from link.',
      callback: () => this.addBook(),
    });

    // Add settings tab
    this.addSettingTab(new AddBookSettingTab(this.app, this));
  }

  onunload(): void {
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Helper function to check if a folder path is root
  private isRootFolder(folderPath: string): boolean {
    const normalized = normalizePath(folderPath.replace(/\/$/, ''));
    return normalized === '' || normalized === '/';
  }

  // Main function to add book
  async addBook() {
    const modal = new UrlInputModal(this.app);
    modal.open();
    
    const url = await modal.promise;
    
    if (!url) {
      new Notice('Please enter a link.', 5000);
      return;
    }

    const source = this.detectSource(url);
    if (!source) {
      new Notice(`This site is not supported.`, 5000);
      return;
    }

    const bookData = await this.fetchBookData(url, source);
    if (!bookData) {
      new Notice('Failed to fetch data.', 5000);
      return;
    }

    // Fetch summary from Google Books API (if not rate limited)
    bookData.summary = await this.fetchSummary(bookData.title, bookData.author, bookData.isbn);

    // Read template (use default if not specified)
    let templateContent: string = '';
    if (this.settings.templatePath) {
      const templatePath = normalizePath(this.settings.templatePath);
      
      const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
      if (templateFile && templateFile instanceof TFile) {
        templateContent = await this.app.vault.read(templateFile);
      } else {
        new Notice('Template not found. Using default.', 5000);
      }
    }

    // If template is empty, use default content
    if (!templateContent) {
      templateContent = `---
title: "{{title}}"
author: "{{author}}"
translator: "{{translator}}"
pages: {{pages}}
cover: "{{cover}}"
publisher: "{{publisher}}"
datepublished: "{{datepublished}}"
ISBN: "{{ISBN}}"
url: "{{url}}"
language: "{{language}}"
description: "{{description}}"
summary: "{{summary}}"
---

`;
    }

    // Helper function to escape YAML string values
    const escapeYamlString = (str: string): string => {
      if (!str) return '';
      // Escape double quotes and backslashes for YAML double-quoted strings
      return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, ' ');
    };

    // Replace placeholders in template
    let noteContent: string = templateContent
      .replace(/{{title}}/g, escapeYamlString(bookData.title))
      .replace(/{{author}}/g, escapeYamlString(bookData.author))
      .replace(/{{pages}}/g, bookData.pages)
      .replace(/{{cover}}/g, escapeYamlString(bookData.cover))
      .replace(/{{publisher}}/g, escapeYamlString(bookData.publisher || ''))
      .replace(/{{translator}}/g, escapeYamlString(bookData.translator || ''))
      .replace(/{{datepublished}}/g, escapeYamlString(bookData.datepublished || ''))
      .replace(/{{ISBN}}/g, escapeYamlString(bookData.isbn || ''))
      .replace(/{{url}}/g, escapeYamlString(bookData.url || ''))
      .replace(/{{language}}/g, escapeYamlString(bookData.language || ''))
      .replace(/{{description}}/g, escapeYamlString(bookData.description || ''))
      .replace(/{{summary}}/g, escapeYamlString(bookData.summary || ''));
    
    // Validate save folder path if specified
    if (this.settings.saveFolder && !this.isRootFolder(this.settings.saveFolder)) {
      const folderPath = normalizePath(this.settings.saveFolder.replace(/\/$/, ''));
      
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folder || !(folder instanceof TFolder)) {
        new Notice('Save folder not found. Please set a valid path in settings.', 5000);
        return;
      }
    }
    
    // Create unique filename
    // Decode HTML entities first, then remove invalid filename characters
    const cleanTitle: string = bookData.title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[\\/*?"<>|]/g, '')  // Remove invalid filename chars (except :)
      .replace(/:/g, ' -')  // Replace : with space-dash
      .replace(/\s+/g, ' ')  // Normalize multiple spaces
      .trim();
    const uniqueFilename: string = this.getUniqueFilename(cleanTitle, this.settings.saveFolder);
    
    // Create new file
    const filePath: string = normalizePath(`${this.settings.saveFolder}/${uniqueFilename}.md`);
    const newFile = await this.app.vault.create(filePath, noteContent);
    new Notice(`New note created: ${uniqueFilename}.md`, 5000);

    // Open the new note if the setting is enabled
    if (this.settings.openAfterCreate) {
      await this.app.workspace.getLeaf().openFile(newFile);
    }
  }

  // Detect source function (from original code)
  detectSource(url: string): string | null {
    // Check for Amazon first (most varied URL formats)
    // Supports: /dp/, /gp/product/, /asin/, /exec/obidos/, amzn.to, a.co short links, all domains
    const amazonPatterns = [
      /amazon\.(com|co\.[a-z]{2}|[a-z]{2})\/(gp\/product|exec\/obidos\/asin|dp|asin|o\/ASIN)\/([A-Z0-9]{10})/i,
      /amzn\.to\//i,
      /a\.co\/[a-zA-Z0-9]+/i,
      /amazon\.(com|co\.[a-z]{2}|[a-z]{2})\/.*[&?]asin=([A-Z0-9]{10})/i
    ];
    for (const pattern of amazonPatterns) {
      if (pattern.test(url)) return 'amazon';
    }

    const patterns: { [key: string]: RegExp } = {
      taaghche: /taaghche\.com\/book\//i,
      fidibo: /fidibo\.com\/(books|book)\//i,
      goodreads: /goodreads\.com\/book\/show\//i
    };
    const match = Object.entries(patterns).find(([_, pattern]) => pattern.test(url));
    return match ? match[0] : null;
  }

  // Helper function to extract JSON-LD data from HTML
  private extractJsonLd(html: string): any | null {
    try {
      const doc: Document = new DOMParser().parseFromString(html, 'text/html');
      const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');

      for (const script of Array.from(jsonLdScripts)) {
        try {
          const jsonData = JSON.parse(script.textContent || '');
          // Check for Book type
          if (jsonData['@type'] === 'Book' ||
              (Array.isArray(jsonData['@type']) &&
               (jsonData['@type'].includes('Book') || jsonData['@type'].includes('Product')))) {
            return jsonData;
          }
          // Check for nested book data (Amazon sometimes has multiple items)
          if (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) {
            for (const item of jsonData['@graph']) {
              if (item['@type'] === 'Book' || item['@type'] === 'Product') {
                return item;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private concatenateAuthors(authors: any[]): string {
    if (!authors || !Array.isArray(authors) || authors.length === 0) {
      return '';
    }
    return authors
      .map((author: any) => {
        if (typeof author === 'string') {
          return author;
        } else if (author && typeof author === 'object' && author.name) {
          return author.name;
        }
        return '';
      })
      .filter((name: string) => name.trim() !== '')
      .join(', ') || '';
  }

  // Helper function to extract __NEXT_DATA__ from HTML
  private extractNextData(html: string): any | null {
    try {
      const doc: Document = new DOMParser().parseFromString(html, 'text/html');
      const nextDataScript = doc.querySelector('script#__NEXT_DATA__');
      
      if (nextDataScript && nextDataScript.textContent) {
        return JSON.parse(nextDataScript.textContent);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Helper function to convert timestamp to yyyy-mm-dd format
  private formatDateFromTimestamp(timestamp: number): string {
    if (!timestamp || isNaN(timestamp)) {
      return '';
    }
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Fetch book summary from Open Library API (primary) then Google Books (fallback)
  async fetchSummary(title: string, author: string, isbn?: string): Promise<string> {
    // Try Open Library API first with ISBN (most reliable)
    if (isbn && isbn.length > 5) {
      try {
        const searchUrl = `https://openlibrary.org/isbn/${isbn}.json`;
        const response = await requestUrl({
          url: searchUrl,
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (response.status === 200 && response.json) {
          const data = response.json;
          let description = '';
          
          if (data.description) {
            description = typeof data.description === 'string' ? data.description : data.description.value || '';
          }
          
          if (description) {
            const cleanDesc = description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanDesc.length > 20) {
              return cleanDesc.substring(0, 500).trim();
            }
          }
        }
      } catch (error) {
        // Continue to search-based lookup
      }
    }

    // Try Open Library search by title
    try {
      const cleanTitle = title.replace(/[:–—-].*$/, '').trim();
      const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitle)}&author=${encodeURIComponent(author.split(',')[0].trim())}&limit=3`;

      const response = await requestUrl({
        url: searchUrl,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (response.status === 200 && response.json) {
        const data = response.json;
        if (data.docs && data.docs.length > 0) {
          // Try to find the best matching book from results
          for (const doc of data.docs.slice(0, 3)) {
            let description = doc.first_sentence || doc.description || '';
            if (Array.isArray(description)) description = description[0] || '';
            
            // If no description in search result, fetch full work details
            if (!description && doc.key) {
              try {
                const workUrl = `https://openlibrary.org${doc.key}.json`;
                const workResponse = await requestUrl({
                  url: workUrl,
                  method: 'GET',
                  headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                if (workResponse.status === 200 && workResponse.json) {
                  const workData = workResponse.json;
                  description = workData.description?.value || workData.description || '';
                }
              } catch (e) {
                // Ignore work fetch errors
              }
            }
            
            if (description) {
              const cleanDesc = description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              if (cleanDesc.length > 20) {
                return cleanDesc.substring(0, 500).trim();
              }
            }
          }
        }
      }
    } catch (error) {
      // Continue to Google Books fallback
    }

    // Fallback to Google Books API
    try {
      let query = '';
      if (isbn && isbn.length > 5) {
        query = `isbn:${isbn}`;
      } else {
        const cleanTitle = title.replace(/[:–—-].*$/, '').trim();
        const cleanAuthor = author.split(',')[0].trim();
        query = `${cleanTitle} ${cleanAuthor}`;
      }

      const apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`;

      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (response.status === 200) {
        const data = response.json;
        if (data.items && data.items.length > 0) {
          // Try multiple items to find best description
          for (const item of data.items.slice(0, 3)) {
            const volumeInfo = item.volumeInfo || {};
            const description = volumeInfo.description || volumeInfo.summary || volumeInfo.textSnippet || '';
            if (description) {
              const cleanDesc = description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              if (cleanDesc.length > 20) {
                return cleanDesc.substring(0, 500).trim();
              }
            }
          }
        }
      }
    } catch (error) {
      // Return empty if both APIs fail
    }

    return '';
  }

  // Fetch book data function (with requestUrl)
  async fetchBookData(url: string, source: string): Promise<BookData | null> {
    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const html: string = response.text;
      const doc: Document = new DOMParser().parseFromString(html, 'text/html');

      if (source === 'taaghche') {
        const jsonLd = this.extractJsonLd(html);
        if (jsonLd) {
          const workExample = jsonLd.workExample || jsonLd;
          const authors = jsonLd.author || [];
          const author = this.concatenateAuthors(authors);

          let translator = '';
          if (workExample.translator && Array.isArray(workExample.translator)) {
            translator = this.concatenateAuthors(workExample.translator);
          }

          const canonicalLink = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
          const canonicalUrl = canonicalLink?.getAttribute('href')?.trim() || url;

          // Extract description from JSON-LD or fallback to HTML
          let description = jsonLd.description || '';
          if (!description) {
            const descriptionSelectors = [
              '[itemprop="description"]',
              '.book-description',
              '.description',
              '.book-summary',
              '.summary-text'
            ];
            for (const selector of descriptionSelectors) {
              const descEl = doc.querySelector(selector);
              if (descEl) {
                description = descEl.textContent?.trim() || '';
                if (description) break;
              }
            }
          }

          return {
            title: jsonLd.name || '',
            author: author,
            pages: workExample.numberOfPages ? String(workExample.numberOfPages) : '',
            cover: jsonLd.image || '',
            publisher: workExample.publisher?.name || '',
            translator: translator || '',
            datepublished: workExample.datePublished || '',
            language: workExample.inLanguage || '',
            url: canonicalUrl,
            description: description
          };
        }
        return null;

      } else if (source === 'fidibo') {
        const titleElement = doc.querySelector('h1.book-main-box-detail-title');
        const authorRow = Array.from(doc.querySelectorAll('tr.book-vl-rows-item'))
          .find(row => row.querySelector('td.book-vl-rows-item-title')?.textContent?.includes("نویسنده"));
        const pagesRow = Array.from(doc.querySelectorAll('tr.book-vl-rows-item'))
          .find(row => row.querySelector('td.book-vl-rows-item-title')?.textContent?.includes("تعداد صفحات"));
        const publisherRow = Array.from(doc.querySelectorAll('tr.book-vl-rows-item'))
          .find(row => row.querySelector('td.book-vl-rows-item-title')?.textContent?.includes("ناشر"));
        const translatorRow = Array.from(doc.querySelectorAll('tr.book-vl-rows-item'))
          .find(row => row.querySelector('td.book-vl-rows-item-title')?.textContent?.includes("مترجم"));
        const datePublishedRow = Array.from(doc.querySelectorAll('tr.book-vl-rows-item'))
          .find(row => row.querySelector('td.book-vl-rows-item-title')?.textContent?.includes("تاریخ انتشار"));
        const languageRow = Array.from(doc.querySelectorAll('tr.book-vl-rows-item'))
          .find(row => row.querySelector('td.book-vl-rows-item-title')?.textContent?.includes("زبان"));
        const fidiboUrl = url;

        // Extract description
        let description = '';
        const descriptionSelectors = [
          '.book-description',
          '.description-text',
          '.about-book',
          '[class*="desc"]',
          '.book-summary',
          '.summary'
        ];
        for (const selector of descriptionSelectors) {
          const descEl = doc.querySelector(selector);
          if (descEl) {
            description = descEl.textContent?.trim() || '';
            if (description) break;
          }
        }

        return {
          title: titleElement?.textContent?.trim() || '',
          author: authorRow?.querySelector('a.book-vl-rows-item-subtitle, div.book-vl-rows-item-subtitle')?.textContent?.trim() || '',
          pages: pagesRow?.querySelector('div.book-vl-rows-item-subtitle')?.textContent?.match(/\d+/)?.[0] || '',
          cover: doc.querySelector('img.book-main-box-img')?.getAttribute("src")?.split('?')[0] || '',
          publisher: publisherRow?.querySelector('a.book-vl-rows-item-subtitle, div.book-vl-rows-item-subtitle')?.textContent?.trim() || '',
          translator: translatorRow?.querySelector('a.book-vl-rows-item-subtitle, div.book-vl-rows-item-subtitle')?.textContent?.trim() || '',
          datepublished: datePublishedRow?.querySelector('a.book-vl-rows-item-subtitle, div.book-vl-rows-item-subtitle')?.textContent?.trim() || '',
          language: languageRow?.querySelector('a.book-vl-rows-item-subtitle, div.book-vl-rows-item-subtitle')?.textContent?.trim() || '',
          url: fidiboUrl,
          description: description
        };
      } else if (source === 'goodreads') {
        const jsonLd = this.extractJsonLd(html);
        if (jsonLd) {
          const authors = jsonLd.author || [];
          const author = this.concatenateAuthors(authors);

          let publisher = '';
          let datepublished = '';
          let description = '';
          let isbn = '';
          const nextData = this.extractNextData(html);

          if (nextData) {
            const findBookDetails = (obj: any, visited: Set<any> = new Set()): any => {
              if (!obj || typeof obj !== 'object' || visited.has(obj) ||
                  obj instanceof Date || obj instanceof RegExp || typeof obj === 'function') {
                return null;
              }
              visited.add(obj);

              const isBookDetails = obj.__typename === 'BookDetails' ||
                (obj.publisher !== undefined && obj.publicationTime !== undefined &&
                 (obj.format !== undefined || obj.numPages !== undefined || obj.asin !== undefined));

              if (isBookDetails) return obj;
              if (obj.details && typeof obj.details === 'object') {
                const detailsResult = findBookDetails(obj.details, visited);
                if (detailsResult) return detailsResult;
              }

              const items = Array.isArray(obj) ? obj : Object.values(obj);
              for (const item of items) {
                const result = findBookDetails(item, visited);
                if (result) return result;
              }
              return null;
            };

            const details = findBookDetails(nextData?.props?.pageProps?.apolloState) ||
                          findBookDetails(nextData?.props?.pageProps) ||
                          findBookDetails(nextData?.props) ||
                          findBookDetails(nextData);

            if (details) {
              publisher = details.publisher ? String(details.publisher).trim() : '';
              datepublished = details.publicationTime ? this.formatDateFromTimestamp(details.publicationTime) : '';
              isbn = details.isbn13 || details.isbn || details.asin || '';
            }

            // Try to extract description from nextData
            const findDescription = (obj: any, visited: Set<any> = new Set()): string | null => {
              if (!obj || typeof obj !== 'object' || visited.has(obj) ||
                  obj instanceof Date || obj instanceof RegExp || typeof obj === 'function') {
                return null;
              }
              visited.add(obj);

              if (obj.description && typeof obj.description === 'string' && obj.description.length > 50) {
                return obj.description;
              }

              const items = Array.isArray(obj) ? obj : Object.values(obj);
              for (const item of items) {
                const result = findDescription(item, visited);
                if (result) return result;
              }
              return null;
            };

            const descFromNextData = findDescription(nextData?.props?.pageProps?.apolloState);
            if (descFromNextData) {
              description = descFromNextData;
            }
          }

          const canonicalLink = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
          const canonicalUrl = canonicalLink?.getAttribute('href')?.trim() || url;

          // Extract description from JSON-LD or fallback to HTML element
          if (!description) {
            if (jsonLd.description) {
              description = typeof jsonLd.description === 'string'
                ? jsonLd.description
                : '';
            }
          }
          // Fallback: try to extract from Goodreads description element
          if (!description) {
            // Try multiple selectors for description (updated for current Goodreads layout)
            const descriptionSelectors = [
              '[data-testid="description"]',
              '.BookPageMetadataSection__description',
              'div[data-automation-id="bookDescription"]',
              'div#bookDescription',
              '.read-more-content',
              '.truncatedText',
              'div#descriptionContainer',
              'div.descriptionContainer',
              '.BookPageDescriptionSection',
              '.BookDescriptionSection',
              '.Description',
              '[class*="description"]',
              '[class*="Description"]'
            ];
            for (const selector of descriptionSelectors) {
              const descriptionEl = doc.querySelector(selector);
              if (descriptionEl) {
                description = descriptionEl.textContent?.trim() || '';
                if (description) break;
              }
            }
          }

          // Extract ISBN from HTML if not found in nextData
          if (!isbn) {
            const isbnText = doc.documentElement.textContent || '';
            const isbn13Match = isbnText.match(/ISBN[-]*13[:\s]*([0-9X-]{10,})/i);
            const isbn10Match = isbnText.match(/ISBN[-]*10[:\s]*([0-9X-]{10,})/i);
            const genericIsbnMatch = isbnText.match(/ISBN[:\s]*([0-9X-]{10,})/i);
            
            if (isbn13Match && isbn13Match[1]) {
              isbn = isbn13Match[1].replace(/-/g, '').trim();
            } else if (isbn10Match && isbn10Match[1]) {
              isbn = isbn10Match[1].replace(/-/g, '').trim();
            } else if (genericIsbnMatch && genericIsbnMatch[1]) {
              isbn = genericIsbnMatch[1].replace(/-/g, '').trim();
            }
          }

          // Clean up description - normalize whitespace and remove extra spaces
          if (description) {
            description = description.replace(/\s+/g, ' ').trim();
          }

          return {
            title: jsonLd.name || '',
            author: author,
            pages: jsonLd.numberOfPages ? String(jsonLd.numberOfPages) : '',
            cover: jsonLd.image || '',
            publisher: publisher,
            translator: '',
            datepublished: datepublished,
            isbn: isbn || jsonLd.isbn || '',
            language: jsonLd.inLanguage || '',
            url: canonicalUrl,
            description: description
          };
        }

        return null;
      } else if (source === 'amazon') {
        // Try to extract JSON-LD data first for more reliable data
        const jsonLd = this.extractJsonLd(html);
        let jsonLdTitle = '';

        if (jsonLd) {
          jsonLdTitle = jsonLd.name || '';
        }

        // Extract title with multiple fallback selectors
        let title = '';
        const titleSelectors = [
          '#productTitle',
          'span#productTitle',
          'h1#title',
          '.product-title',
          '.a-size-medium',
          'h1.a-size-large'
        ];
        for (const selector of titleSelectors) {
          const titleEl = doc.querySelector(selector);
          if (titleEl) {
            title = titleEl.textContent?.trim().replace(/\s+/g, ' ') || '';
            if (title) break;
          }
        }
        // Fallback to JSON-LD title if no HTML title found
        if (!title && jsonLdTitle) {
          title = jsonLdTitle;
        }
        // Clean up title - remove parenthetical category suffixes like "(Bird Books, Books for Bird Lovers)"
        if (title) {
          title = title.replace(/\s*\([^)]*(?:Bird Books|Books for|Humor Books|Gift Books|Children's Books|Teen & Young Adult|Education & Reference)[^)]*\)\s*/i, '').trim();
          // Also remove any trailing parenthetical content that looks like categories
          title = title.replace(/\s*\([^)]{30,}\)\s*$/i, '').trim();
        }

        const bylineInfo = doc.querySelector('div#bylineInfo');
        const authors: string[] = [];
        const translators: string[] = [];

        if (bylineInfo) {
          const authorSpans = bylineInfo.querySelectorAll('span.author');
          authorSpans.forEach((span) => {
            const nameElement = span.querySelector('a.a-link-normal');
            const contributionElement = span.querySelector('span.contribution span.a-color-secondary');

            if (nameElement) {
              const name = nameElement.textContent?.trim() || '';
              const contribution = contributionElement?.textContent?.trim() || '';

              if (name) {
                if (contribution.includes('Translator')) {
                  translators.push(name);
                } else if (contribution.includes('Author') || contribution === '') {
                  authors.push(name);
                }
              }
            }
          });
        }

        // Fallback to old method if bylineInfo not found
        let author: string = authors.length > 0 ? authors.join(', ') : '';
        if (author === '') {
          const authorElement = doc.querySelector('span.author a.a-link-normal, #bylineInfo a.a-link-normal');
          author = authorElement?.textContent?.trim() || '';
        }
        const translator: string = translators.length > 0 ? translators.join(', ') : '';

        // Extract pages with multiple fallback selectors
        let pages = '';
        const pagesElements = doc.querySelectorAll('#detailBullets_feature_div li span.a-size-base, .rpi-attribute-value span, #booksProductDetails_feature_div li span.a-size-base');
        for (const el of Array.from(pagesElements)) {
          const text = el.textContent?.trim() || '';
          if (text.toLowerCase().includes('page') || text.toLowerCase().includes('print length')) {
            const pageMatch = text.match(/\d+/);
            if (pageMatch) {
              pages = pageMatch[0];
              break;
            }
          }
        }
        // Fallback to data-attribute
        if (!pages) {
          const pagesEl = doc.querySelector('[data-attribute="number_of_pages"]');
          if (pagesEl) {
            const text = pagesEl.textContent?.trim() || '';
            const pageMatch = text.match(/\d+/);
            if (pageMatch) pages = pageMatch[0];
          }
        }

        const coverElement = doc.querySelector('img#landingImage');
        let cover: string = "";
        if (coverElement) {
          cover = coverElement.getAttribute('src') || "";
          const highResImage = coverElement.getAttribute('data-old-hires');
          if (highResImage) {
            cover = highResImage;
          }
        }

        // Extract publisher with fallback selectors
        let publisher = '';
        const publisherElements = doc.querySelectorAll('#detailBullets_feature_div li, #booksProductDetails_feature_div li, .rpi-attribute-value span');
        for (const el of Array.from(publisherElements)) {
          const text = el.textContent?.trim() || '';
          if (text.toLowerCase().includes('publisher') && !text.toLowerCase().includes('publication')) {
            const pubMatch = text.split(/[:–—-]/).pop()?.trim() || '';
            if (pubMatch && pubMatch.length > 1) {
              publisher = pubMatch;
              break;
            }
          }
        }
        if (!publisher) {
          const pubEl = doc.querySelector('[data-attribute="publisher"]');
          publisher = pubEl?.textContent?.trim() || '';
        }

        // Extract date published with fallback selectors
        let datepublished = '';
        const dateElements = doc.querySelectorAll('#detailBullets_feature_div li, #booksProductDetails_feature_div li, .rpi-attribute-value span');
        for (const el of Array.from(dateElements)) {
          const text = el.textContent?.trim() || '';
          if (text.toLowerCase().includes('publication date') || text.toLowerCase().includes('publish date')) {
            const dateMatch = text.split(/[:–—-]/).pop()?.trim() || '';
            if (dateMatch && dateMatch.length > 1) {
              datepublished = dateMatch;
              break;
            }
          }
        }
        if (!datepublished) {
          const dateEl = doc.querySelector('[data-attribute="publication_date"]');
          datepublished = dateEl?.textContent?.trim() || '';
        }

        const languageElement = doc.querySelector('#rpi-attribute-language .rpi-attribute-value span, [data-attribute="language"]');
        const language: string = languageElement?.textContent?.trim() || '';

        const isbnElement = doc.querySelector('#rpi-attribute-book_details-isbn13 .rpi-attribute-value span, [data-attribute="isbn_13"]');
        const isbn: string = isbnElement?.textContent?.trim() || '';
        const canonicalLink = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
        const canonicalUrl = canonicalLink?.getAttribute('href')?.trim() || url;

        // Note: Amazon loads descriptions dynamically via JavaScript, so we cannot reliably extract them
        // Users should use Goodreads links for description fetching
        const description = '';

        return {
          title: title || '',
          author: author,
          pages: pages,
          cover: cover,
          publisher: publisher,
          translator: translator,
          datepublished: datepublished,
          language: language,
          isbn: isbn,
          url: canonicalUrl,
          description: description
        };
      }

      return null;
    } catch (error) {
      new Notice(`Error fetching ${source}: ${(error as Error).message}`, 5000);
      return null;
    }
  }

  // Unique filename function (adapted)
  getUniqueFilename(baseName: string, folder: string): string {
    const normalizedFolder = folder ? normalizePath(folder.replace(/\/$/, '')) : '';
    let counter: number = 1;
    let newName: string = baseName;
    
    const files = this.app.vault.getMarkdownFiles().filter(f => {
      if (normalizedFolder === '') {
        return f.parent === this.app.vault.getRoot();
      } else {
        return f.parent?.path === normalizedFolder;
      }
    });

    while (files.some(file => file.basename === newName)) {
      newName = `${baseName} ${counter}`;
      counter++;
    }
    return newName;
  }
}

// Helper function for type predicate
function isTFolder(f: TAbstractFile): f is TFolder {
  return f instanceof TFolder;
}

// Modal for URL input
class UrlInputModal extends Modal {
  promise: Promise<string>;
  resolve: ((value: string) => void) | null;
  input: HTMLInputElement;

  constructor(app: App) {
    super(app);
    this.resolve = null;
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Enter book URL' });

    this.input = contentEl.createEl('input', { type: 'text', cls: 'add-book-url-input' });
    this.input.focus();

    const buttonContainer = contentEl.createEl('div', { cls: 'add-book-button-container' });
    const button = buttonContainer.createEl('button', { text: 'Submit', cls: 'add-book-submit-button' });
    button.addEventListener('click', () => {
      if (this.resolve) {
        this.resolve(this.input.value);
        this.resolve = null;
      }
      this.close();
    });

    // Handle Enter key
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.resolve) {
          this.resolve(this.input.value);
          this.resolve = null;
        }
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
    if (this.resolve) {
      this.resolve('');
      this.resolve = null;
    }
  }
}

// File Suggest class
class FileSuggest extends AbstractInputSuggest<TFile> {
  textComponent: TextComponent;

  constructor(app: App, textComponent: TextComponent) {
    super(app, textComponent.inputEl);
    this.textComponent = textComponent;
  }

  protected getSuggestions(query: string): TFile[] {
    const files = this.app.vault.getMarkdownFiles();
    const lowerQuery = query.toLowerCase();
    return files.filter(file => file.path.toLowerCase().includes(lowerQuery));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.textComponent.setValue(file.path);
    this.textComponent.inputEl.dispatchEvent(new Event('input'));
    this.close();
  }
}

// Folder Suggest class
class FolderSuggest extends AbstractInputSuggest<TFolder> {
  textComponent: TextComponent;

  constructor(app: App, textComponent: TextComponent) {
    super(app, textComponent.inputEl);
    this.textComponent = textComponent;
  }

  protected getSuggestions(query: string): TFolder[] {
    const abstractFiles = this.app.vault.getAllLoadedFiles();
    const folders = abstractFiles.filter(isTFolder);
    const lowerQuery = query.toLowerCase();
    return folders.filter(folder => {
      const path = folder.path === '' ? '/' : folder.path;
      return path.toLowerCase().includes(lowerQuery);
    });
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    const path = folder.path === '' ? '/' : folder.path;
    el.setText(path);
  }

  selectSuggestion(folder: TFolder): void {
    const path = folder.path === '' ? '/' : folder.path;
    this.textComponent.setValue(path);
    this.textComponent.inputEl.dispatchEvent(new Event('input'));
    this.close();
  }
}

// Settings tab class
class AddBookSettingTab extends PluginSettingTab {
  plugin: AddBookPlugin;

  constructor(app: App, plugin: AddBookPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Setting for template path
    new Setting(containerEl)
      .setName('Template note path')
      .setDesc('Path to the template note. If empty, uses default template.')
      .addText(text => {
        text
          .setPlaceholder('Templates/book-template.md')
          .setValue(this.plugin.settings.templatePath)
          .onChange(async (value) => {
            value = value.trim();
            this.plugin.settings.templatePath = normalizePath(value);
            await this.plugin.saveSettings();
          });
        new FileSuggest(this.app, text);
      });

    // Setting for save folder
    new Setting(containerEl)
      .setName('Save folder path')
      .setDesc('Folder to save new notes. If empty, saves to root.')
      .addText(text => {
        text
          .setPlaceholder('Books/')
          .setValue(this.plugin.settings.saveFolder)
          .onChange(async (value) => {
            let normalized = normalizePath(value);
            this.plugin.settings.saveFolder = normalized;
            await this.plugin.saveSettings();
          });
        new FolderSuggest(this.app, text);
      });

    // Setting for opening note after creation
    new Setting(containerEl)
      .setName('Open note after creation')
      .setDesc('Automatically open the newly created note.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.openAfterCreate)
        .onChange(async (value) => {
          this.plugin.settings.openAfterCreate = value;
          await this.plugin.saveSettings();
        }));
  }
}