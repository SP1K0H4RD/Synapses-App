import JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';

interface XMindTopic {
  id: string;
  title: string;
  class?: string;
  structureClass?: string;
  children?: {
    attached: XMindTopic[];
  };
}

// User-provided templates (metadata and manifest from snippets)
const METADATA_CONTENT = {
  "dataStructureVersion": "2",
  "creator": { "name": "Vana", "version": "23.09.11172" },
  "layoutEngineVersion": "3"
};

const MANIFEST_CONTENT = {
  "file-entries": {
    "content.json": {},
    "metadata.json": {},
    "Thumbnails/thumbnail.png": {}
  }
};

// XML content from the user's snippet
const CONTENT_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink" modified-by="bruce" timestamp="1503058545540" version="2.0"><sheet id="7abtd0ssc7n4pi1nu6i7b6lsdh" modified-by="bruce" theme="0kdeemiijde6nuk97e4t0vpp54" timestamp="1503058545540"><topic id="1vr0lcte2og4t2sopiogvdmifc" modified-by="bruce" structure-class="org.xmind.ui.logic.right" timestamp="1503058545417"><title>Warning</title></topic><title>Sheet 1</title></sheet></xmap-content>`;

// Theme data from the user's content.json example
const THEME_DATA = {
  "map": { 
    "id": uuidv4(), 
    "properties": { 
      "svg:fill": "#ffffff", 
      "multi-line-colors": "#F9423A #F6A04D #F3D321 #00BC7B #486AFF #4D49BE", 
      "color-list": "#000229 #1F2766 #52CC83 #4D86DB #99142F #245570", 
      "line-tapered": "none" 
    } 
  },
  "centralTopic": { 
    "id": uuidv4(), 
    "properties": { 
      "fo:font-family": "NeverMind", 
      "fo:font-size": "30pt", 
      "fo:font-weight": "500", 
      "fo:font-style": "normal", 
      "fo:color": "inherited", 
      "fo:text-transform": "manual", 
      "fo:text-decoration": "none", 
      "fo:text-align": "center", 
      "svg:fill": "#000229", 
      "fill-pattern": "solid", 
      "line-width": "3pt", 
      "line-color": "#000229", 
      "line-pattern": "solid", 
      "border-line-color": "inherited", 
      "border-line-width": "0pt", 
      "border-line-pattern": "inherited", 
      "shape-class": "org.xmind.topicShape.roundedRect", 
      "line-class": "org.xmind.branchConnection.curve", 
      "arrow-end-class": "org.xmind.arrowShape.none", 
      "alignment-by-level": "inactived" 
    } 
  },
  "mainTopic": { 
    "id": uuidv4(), 
    "properties": { 
      "fo:font-family": "NeverMind", 
      "fo:font-size": "18pt", 
      "fo:font-weight": "500", 
      "fo:font-style": "normal", 
      "fo:color": "inherited", 
      "fo:text-transform": "manual", 
      "fo:text-decoration": "none", 
      "fo:text-align": "left", 
      "svg:fill": "inherited", 
      "fill-pattern": "solid", 
      "line-width": "2pt", 
      "line-color": "inherited", 
      "line-pattern": "inherited", 
      "border-line-color": "inherited", 
      "border-line-width": "0pt", 
      "border-line-pattern": "inherited", 
      "shape-class": "org.xmind.topicShape.roundedRect", 
      "line-class": "org.xmind.branchConnection.roundedElbow", 
      "arrow-end-class": "inherited" 
    } 
  }
};

/**
 * Parses Markdown with indentation into a hierarchical XMind topic structure.
 */
function parseMarkdownToTopics(md: string) {
  const lines = md.split('\n').filter(l => l.trim() !== '');
  let rootTitle = "Mapa Mental";
  
  interface Node {
    title: string;
    level: number;
    children: Node[];
  }

  const nodes: Node[] = [];
  const stack: Node[] = [];

  for (let line of lines) {
    // Detect root title (#)
    if (line.trim().startsWith('# ')) {
      rootTitle = line.trim().replace(/^#\s+/, '');
      continue;
    }

    // Determine level by indentation (groups of 2 or 4 spaces) or ## markers
    let level = 0;
    let title = "";

    if (line.trim().startsWith('## ')) {
      level = 1;
      title = line.trim().replace(/^##\s+/, '');
    } else if (line.trim().startsWith('### ')) {
      level = 2;
      title = line.trim().replace(/^###\s+/, '');
    } else {
      // For lists/nested items, count leading spaces
      const match = line.match(/^(\s*)/);
      const indent = match ? match[0].length : 0;
      
      // AI usually uses 2 or 4 spaces for depth
      // We map this to levels starting from 3 if it's under H3, or 2 if under H2
      // Let's use a simpler stack approach for bullet points
      const listContent = line.trim();
      if (listContent.startsWith('- ') || listContent.startsWith('* ')) {
        // level = (indent / 2) + 2; // Default logic
        // Better: count the indentation relative to the hierarchy
        level = Math.floor(indent / 2) + 3; 
        title = listContent.replace(/^[-*+]\s+/, '');
      } else {
        continue; // Skip lines that aren't headers or list items
      }
    }

    const newNode: Node = { title, level, children: [] };

    // Find the parent by going up the stack
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(newNode);
    } else {
      nodes.push(newNode);
    }
    stack.push(newNode);
  }

  // Recursive converter to XMind JSON format
  const convertToXMind = (node: Node): XMindTopic => {
    const topic: XMindTopic = {
      id: uuidv4(),
      title: node.title,
    };
    if (node.children.length > 0) {
      topic.children = {
        attached: node.children.map(convertToXMind)
      };
    }
    return topic;
  };

  return {
    rootTitle,
    topics: nodes.map(convertToXMind)
  };
}

export async function convertMdToXMind(mdContent: string): Promise<Blob> {
  const { rootTitle, topics } = parseMarkdownToTopics(mdContent);
  const zip = new JSZip();

  const contentJson = [{
    "id": uuidv4(),
    "class": "sheet",
    "rootTopic": {
      "id": uuidv4(),
      "class": "topic",
      "title": rootTitle,
      "structureClass": "org.xmind.ui.map.clockwise",
      "children": {
        "attached": topics
      }
    },
    "title": "Sheet 1",
    "theme": THEME_DATA,
    "extensions": [
      { 
        "provider": "org.xmind.ui.skeleton.structure.style", 
        "content": { "centralTopic": "org.xmind.ui.map.clockwise" } 
      }
    ]
  }];

  zip.file('content.json', JSON.stringify(contentJson));
  zip.file('metadata.json', JSON.stringify(METADATA_CONTENT));
  zip.file('manifest.json', JSON.stringify(MANIFEST_CONTENT));
  zip.file('content.xml', CONTENT_XML_TEMPLATE);
  zip.folder('Thumbnails');

  return await zip.generateAsync({ type: 'blob' });
}
