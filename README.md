English | [فارسی](https://github.com/fardm/obsidian-book-clipper/blob/master/README-fa.md)


# Book Clipper

![image](image.webp)


This plugin imports book information from these websites into Obsidian:

- <img src="https://www.google.com/s2/favicons?sz=64&amp;domain=https%3a%2f%2fwww.goodreads.com%2f" width="18px" height="18px" align="center"> [goodreads.com](https://www.goodreads.com/)
- <img src="https://www.google.com/s2/favicons?sz=64&amp;domain=https%3a%2f%2fwww.amazon.com%2f" width="18px" height="18px" align="center"> [amazon.com](https://www.amazon.com/)
- <img src="https://www.google.com/s2/favicons?sz=64&amp;domain=https%3a%2f%2ftaaghche.com%2f" width="18px" height="18px" align="center"> [taaghche.com](https://taaghche.com/)
- <img src="https://www.google.com/s2/favicons?sz=64&amp;domain=https%3a%2f%2ffidibo.com%2f" width="18px" height="18px" align="center"> [fidibo.com](https://fidibo.com/)




<br>

**Available Variables**

- {{title}}
- {{author}}
- {{translator}}
- {{pages}}
- {{cover}}
- {{publisher}}
- {{datepublished}}
- {{ISBN}}
- {{url}}
- {{language}}
- {{description}}
- {{summary}} ✨

<br>

**{{description}} vs {{summary}}**

| Variable | Source | Availability |
|----------|--------|--------------|
| `{{description}}` | Scraped from the book page | Goodreads, Taaghche, Fidibo |
| `{{summary}}` | Fetched from Open Library API (fallback: Google Books) | All sources |

- **`{{description}}`**: Publisher's official description from the source website
- **`{{summary}}`**: Book summary/overview from Open Library or Google Books API (~500 characters)

<br>

⚠️ On Goodreads `{{translator}}` isn't returned because authors and translators aren't properly separated in the JSON-LD we use for web scraping. As a result, both end up in the `author` field.


<br>

## ⚙️ Installation

### Official Version (via Obsidian Community Plugins)
1. Open [this link](https://obsidian.md/plugins?id=book-clipper).
2. Select **Open Obsidian**.
3. Click the **Install** button.

### This Fork (via BRAT Plugin)
This version includes additional features and improvements not yet merged into the official release:

**Enhanced Features:**
- ✨ **`{{summary}}` variable** - Auto-fetches book summaries from Open Library API (with Google Books fallback)
- 📝 **`{{description}}` for more sources** - Now works with Goodreads, Taaghche, and Fidibo
- 🛒 **Improved Amazon support** - Better URL detection (a.co, amzn.to, all domains), title cleanup, page count extraction
- 📁 **Better filename handling** - Converts `:` to ` - `, decodes HTML entities (`&amp;` → `&`)

**Installation Steps:**
1. Install the [BRAT Plugin](https://obsidian.md/plugins?id=obsidian42-brat) from Community Plugins
2. Open BRAT settings → **Add a plugin**
3. Enter: `zaco-tm/obsidian-book-clipper`
4. Click **Add Plugin**
5. Install version `v0.5.13` (or latest)

<br>

## 🛠️ Usage
1. Create a template note (e.g. `book-template.md`) and insert the variables above in the properties or content.
2. Place the template in a folder like `templates`.
3. Create a folder for your books (e.g. `my books`).
4. In plugin settings:
    - **Template note path** → `templates/book-template`
    - **Save folder path** → `my books`
5. Open the **Command Palette** and run `Add book from link`.
6. Enter the book link and confirm.

https://github.com/user-attachments/assets/4664c45e-e177-40b9-aa0d-d0c7f0bc8a60

<br>

## ⚠️ Disclaimer
This plugin is designed solely for personal and non-commercial use. The developer is not responsible for any potential misuse.

<br>

## ☕ Support
This project is offered for free so everyone can use it without restrictions.
If you found this tool useful, you can support its continuous development and improvement through donations.

[Donate via Coffeete](https://www.coffeete.ir/ifard)

