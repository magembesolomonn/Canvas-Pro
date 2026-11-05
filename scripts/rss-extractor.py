import json
import sys

from lxml import html as lxml_html
import trafilatura
from trafilatura.metadata import extract_metadata


def remove_duplicate_paragraphs(content):
    try:
        document = lxml_html.fromstring(content)
        seen = set()
        for paragraph in document.xpath("//p"):
            text = " ".join(paragraph.text_content().split())
            if text and text in seen:
                paragraph.drop_tree()
            elif text:
                seen.add(text)
        return lxml_html.tostring(document, encoding="unicode", method="html")
    except (ValueError, TypeError):
        return content


def main():
    request = json.load(sys.stdin)
    html = request.get("html", "")
    url = request.get("url", "")
    if not isinstance(html, str) or not isinstance(url, str):
        raise ValueError("Invalid article extraction request.")

    content = trafilatura.extract(
        html,
        url=url,
        output_format="html",
        include_comments=False,
        include_formatting=True,
        include_images=True,
        include_links=True,
        include_tables=True,
        favor_precision=True,
    )
    metadata = extract_metadata(html, default_url=url)
    result = {
        "contentHTML": remove_duplicate_paragraphs(content) if content else "",
        "title": getattr(metadata, "title", None) or "",
        "author": getattr(metadata, "author", None) or "",
        "date": getattr(metadata, "date", None) or "",
        "description": getattr(metadata, "description", None) or "",
        "imageURL": getattr(metadata, "image", None) or "",
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
