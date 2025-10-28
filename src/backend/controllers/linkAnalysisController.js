const cheerio = require('cheerio');
const dns = require('dns').promises;
const { URL } = require('url');
const AnalysisTask = require('../models/AnalysisTask');
const Project = require('../models/Project');
const User = require('../models/User');
const FrontendLink = require('../models/FrontendLink');
const userAgents = require('./userAgents');
const { createContext, closeContext, resolveShortUrl } = require('./playwrightUtils');
const { analysisQueue } = require('./taskQueue');

const validateUrlAndTask = async (link) => {
  const task = await AnalysisTask.findById(link.taskId);
  if (!task || task.status === 'cancelled') {
    console.log(`checkLinkStatus: Task ${link.taskId} cancelled, skipping link ${link.url}`);
    return { isValid: false, link };
  }

  try {
    new URL(link.url);
  } catch (error) {
    console.error(`Invalid URL detected: ${link.url}`);
    link.status = 'broken';
    link.errorDetails = `Invalid URL: ${link.url}`;
    link.isIndexable = false;
    link.indexabilityStatus = 'invalid-url';
    link.responseCode = 'Error';
    link.overallStatus = 'Problem';
    link.lastChecked = new Date();
    try {
      await link.save();
    } catch (saveError) {
      if (saveError.name === 'DocumentNotFoundError') {
        console.log(`checkLinkStatus: FrontendLink ${link._id} not found, likely deleted during cancellation`);
        return { isValid: false, link };
      }
      throw saveError;
    }
    return { isValid: false, link };
  }

  const domain = new URL(link.url).hostname;
  try {
    await dns.lookup(domain);
    console.log(`DNS resolved successfully for ${domain}`);
  } catch (error) {
    console.error(`DNS resolution failed for ${domain}: ${error.message}`);
    link.status = 'broken';
    link.errorDetails = `DNS resolution failed: ${error.message}`;
    link.isIndexable = false;
    link.indexabilityStatus = 'dns-error';
    link.responseCode = 'Error';
    link.overallStatus = 'Problem';
    link.lastChecked = new Date();
    try {
      await link.save();
    } catch (saveError) {
      if (saveError.name === 'DocumentNotFoundError') {
        console.log(`checkLinkStatus: FrontendLink ${link._id} not found, likely deleted during cancellation`);
        return { isValid: false, link };
      }
      throw saveError;
    }
    return { isValid: false, link };
  }

  return { isValid: true, link };
};

const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    let normalized = parsed.hostname + parsed.pathname;
    normalized = normalized.replace(/^www\./, '');
    normalized = normalized.replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

const navigateToPage = async (page, url, selectedAgent) => {
  // Playwright: установка заголовков через context.setExtraHTTPHeaders или напрямую
  await page.setExtraHTTPHeaders(selectedAgent.headers);
  
  // Playwright: перехват запросов через page.route()
  await page.route('**/*', (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const requestUrl = request.url();
    
    // Блокируем медиа, шрифты и изображения (кроме logo/icon)
    if (
      ['media', 'font'].includes(resourceType) ||
      (resourceType === 'image' && !requestUrl.includes('logo') && !requestUrl.includes('icon'))
    ) {
      route.abort();
    } else {
      route.continue();
    }
  });

  const startTime = Date.now();
  let response;
  let finalUrl = url;

  try {
    console.log(`[NavigateToPage] Navigating to ${url} with UA: ${selectedAgent.ua.substring(0, 50)}...`);
    response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    finalUrl = page.url();
    console.log(`[NavigateToPage] ✅ Page loaded with status: ${response?.status() || 'No response'}, Final URL: ${finalUrl}`);
  } catch (error) {
    console.error(`[NavigateToPage] ❌ Navigation failed for ${url}:`, error.message);
    throw error;
  }

  return {
    response,
    status: response?.status() || null,
    loadTime: Date.now() - startTime,
    finalUrl,
  };
};

const extractPageData = async (page, link, response, loadTime, finalUrl) => {
  // Playwright: получаем HTML через page.content()
  let $ = cheerio.load(await page.content());

  const statusCode = response ? response.status() : null;
  if (statusCode === 200 || statusCode === 304) {
    try {
      console.log(`[ExtractPageData] Attempting to scroll page for ${link.url} (status: ${statusCode})`);
      
      // Playwright: скроллинг страницы
      await page.evaluate(async () => {
        const targetElement = document.querySelector('footer') ||
          Array.from(document.querySelectorAll('*:not(script):not(style)'))
            .find(el => el.textContent.includes('©') || el.textContent.toLowerCase().includes('copyright'));
        
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
          window.scrollTo(0, document.body.scrollHeight);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        window.scrollTo(0, document.body.scrollHeight);
      });

      // Playwright: waitForTimeout вместо Promise
      await page.waitForTimeout(2000);
      console.log(`[ExtractPageData] ✅ Successfully scrolled page twice for ${link.url}`);
    } catch (scrollError) {
      console.error(`[ExtractPageData] ⚠️ Failed to scroll page for ${link.url}:`, scrollError.message);
    }
  }

  // Playwright: ожидание загрузки страницы
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 })
    .catch(() => console.log(`[ExtractPageData] Timeout waiting for page to fully load for ${link.url}`));

  // Дополнительная задержка для асинхронного контента
  const randomDelay = Math.floor(Math.random() * 2000) + 1000;
  await page.waitForTimeout(randomDelay);

  // Playwright: получаем обновленный HTML после скроллинга
  let content;
  try {
    content = await page.content();
  } catch (error) {
    console.error(`[ExtractPageData] ❌ Failed to extract HTML for ${link.url}:`, error.message);
    link.status = 'broken';
    link.errorDetails = `Failed to extract HTML: ${error.message}`;
    link.isIndexable = false;
    link.indexabilityStatus = `check failed: ${error.message}`;
    link.responseCode = 'Error';
    link.overallStatus = 'Problem';
    await link.save();
    return { isMetaRobotsFound: false, linksFound: null };
  }

  $ = cheerio.load(content);

  let isMetaRobotsFound = false;
  link.isIndexable = true;
  try {
    const metaRobots = $('meta[name="robots"], meta[name="googlebot"]').attr('content')?.toLowerCase();
    if (metaRobots) {
      isMetaRobotsFound = true;
      const robotsValues = metaRobots.split(',').map(val => val.trim());
      if (robotsValues.includes('noindex') || robotsValues.includes('none')) {
        link.isIndexable = false;
        link.indexabilityStatus = 'noindex-meta-tag';
      }
    }
  } catch (error) {
    console.error(`Failed to extract meta robots for ${link.url}:`, error.message);
  }

  link.canonicalUrl = $('link[rel="canonical"]').attr('href') || null;
if (link.isIndexable && link.canonicalUrl) {
  const currentUrl = finalUrl.toLowerCase().replace(/\/$/, '');
  const canonicalNormalized = link.canonicalUrl.toLowerCase().replace(/\/$/, '');
  if (currentUrl !== canonicalNormalized) {
    link.indexabilityStatus = 'canonicalized';
  }
}

  link.responseCode = response ? response.status().toString() : 'Timeout';
  link.loadTime = loadTime;

  const extractLinks = async () => {
    try {
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors
          .map(anchor => ({
            href: anchor.href,
            rel: anchor.getAttribute('rel') || '',
          }))
          .filter(link => link.href && link.href.startsWith('http'));
      });
      console.log(`Extracted links for ${link.url}: ${JSON.stringify(links)}`); // Отладка
      return links;
    } catch (error) {
      console.error(`Error extracting links for ${link.url}:`, error.message);
      return [];
    }
  };

  const findLinkForDomains = async (targetDomains) => {
    let foundLink = null;

    const resolvedLinks = await extractLinks();
    resolvedLinks.forEach(linkData => {
      const href = linkData.href.toLowerCase();
      // Проверяем, указывает ли href на один из targetDomains
      const matchesTarget = targetDomains.some(domain => href.includes(domain));
      if (matchesTarget) {
        foundLink = {
          href: linkData.href,
          rel: linkData.rel,
          anchorText: 'Found in content',
          source: 'extracted',
        };
        console.log(`Link found in extracted URLs: ${JSON.stringify(foundLink)}`);
      }
    });

    if (foundLink) return foundLink;

    $('a').each((i, a) => {
      const href = $(a).attr('href')?.toLowerCase().trim();
      if (href) {
        // Проверяем, указывает ли href на один из targetDomains
        const matchesTarget = targetDomains.some(domain => href.includes(domain));
        if (matchesTarget) {
          const anchorText = $(a).text().trim();
          const hasSvg = $(a).find('svg').length > 0;
          const hasImg = $(a).find('img').length > 0;
          const hasIcon = $(a).find('i').length > 0;
          const hasChildren = $(a).children().length > 0;
          foundLink = {
            href: href,
            rel: $(a).attr('rel') || '',
            anchorText: anchorText || (hasSvg ? 'SVG link' : hasImg ? 'Image link' : hasIcon ? 'Icon link' : hasChildren ? 'Element link' : 'no text'),
            source: 'a',
          };
          console.log(`Link found in <a>: ${JSON.stringify(foundLink)}`);
          return false;
        }
      }
    });

    if (foundLink) return foundLink;

    const eventAttributes = ['onclick', 'onmouseover', 'onmouseout', 'onchange'];
    eventAttributes.forEach(attr => {
      $(`[${attr}]`).each((i, el) => {
        const eventCode = $(el).attr(attr)?.toLowerCase();
        if (eventCode) {
          const matchesDomain = targetDomains.some(domain => eventCode.includes(domain));
          if (matchesDomain) {
            const urlMatch = eventCode.match(/(?:window\.location\.href\s*=\s*['"]([^'"]+)['"]|['"](https?:\/\/[^'"]+)['"])/i);
            if (urlMatch) {
              const href = urlMatch[1] || urlMatch[2];
              const tagName = $(el).prop('tagName').toLowerCase();
              foundLink = {
                href: href.toLowerCase(),
                rel: '',
                anchorText: `Link in ${tagName} ${attr}`,
                source: `event_${attr}`,
              };
              console.log(`Link found in ${attr}: ${JSON.stringify(foundLink)}`);
              return false;
            }
          }
        }
      });
    });

    if (foundLink) return foundLink;

    const tagsToCheck = ['img', 'i', 'svg'];
    tagsToCheck.forEach(tag => {
      $(tag).each((i, el) => {
        const parentA = $(el).closest('a');
        if (parentA.length) {
          const href = parentA.attr('href')?.toLowerCase().trim();
          if (href) {
            const matchesDomain = targetDomains.some(domain => href.includes(domain));
            if (matchesDomain) {
              const anchorText = `Link in ${tag}`;
              foundLink = {
                href: href,
                rel: parentA.attr('rel') || '',
                anchorText: anchorText,
                source: `${tag}_parent_a`,
              };
              console.log(`Link found in parent <a> of <${tag}>: ${JSON.stringify(foundLink)}`);
              return false;
            }
          }
        }

        eventAttributes.forEach(attr => {
          const eventCode = $(el).attr(attr)?.toLowerCase();
          if (eventCode) {
            const matchesDomain = targetDomains.some(domain => eventCode.includes(domain));
            if (matchesDomain) {
              const urlMatch = eventCode.match(/(?:window\.location\.href\s*=\s*['"]([^'"]+)['"]|['"](https?:\/\/[^'"]+)['"])/i);
              if (urlMatch) {
                const href = urlMatch[1] || urlMatch[2];
                foundLink = {
                  href: href.toLowerCase(),
                  rel: '',
                  anchorText: `Link in ${tag} ${attr}`,
                  source: `${tag}_event_${attr}`,
                };
                console.log(`Link found in <${tag}> ${attr}: ${JSON.stringify(foundLink)}`);
                return false;
              }
            }
          }
        });
      });
    });

    if (foundLink) return foundLink;

    $('script').each((i, script) => {
      const scriptContent = $(script).html()?.toLowerCase();
      if (scriptContent) {
        const matchesDomain = targetDomains.some(domain => scriptContent.includes(domain));
        if (matchesDomain) {
          const urlMatch = scriptContent.match(/(?:window\.location\.href\s*=\s*['"]([^'"]+)['"]|['"](https?:\/\/[^'"]+)['"])/i);
          if (urlMatch) {
            const href = urlMatch[1] || urlMatch[2];
            foundLink = {
              href: href.toLowerCase(),
              rel: '',
              anchorText: 'Link in JavaScript',
              source: 'script',
            };
            console.log(`Link found in <script>: ${JSON.stringify(foundLink)}`);
            return false;
          }
        }
      }
    });

    return foundLink;
  };

  const cleanTargetDomains = link.targetDomains.map(domain => normalizeUrl(domain));
  const linksFound = await findLinkForDomains(cleanTargetDomains);

  return { isMetaRobotsFound, linksFound };
};

const updateLinkStatus = (link, isMetaRobotsFound, linksFound) => {
  const isLinkFound = linksFound !== null;
  const hasUsefulData = isLinkFound || isMetaRobotsFound;

  if (hasUsefulData) {
    if (isLinkFound) {
      link.status = 'active';
      link.rel = linksFound.rel || '';
      link.anchorText = linksFound.anchorText;
      const relValues = link.rel ? link.rel.toLowerCase().split(' ') : [];
      console.log(`[UpdateLinkStatus] Link ${link.url}: rel="${link.rel}", relValues=${relValues}`);
      link.linkType = relValues.includes('nofollow') ? 'nofollow' : 'dofollow';
      link.errorDetails = link.errorDetails || '';
    } else {
      link.status = 'active';
      link.rel = 'not found';
      link.linkType = 'unknown';
      link.anchorText = 'not found';
      link.errorDetails = link.errorDetails || '';
    }
    link.overallStatus = (link.responseCode === '200' || link.responseCode === '304') && link.isIndexable && isLinkFound ? 'OK' : 'Problem';
  } else {
    link.status = 'broken';
    link.rel = 'not found';
    link.linkType = 'unknown';
    link.anchorText = 'not found';
    link.errorDetails = link.errorDetails || 'No useful data found';
    link.overallStatus = 'Problem';
  }

  link.lastChecked = new Date();
};

const checkLinkStatus = async (link) => {
  let context;
  let page;
  let attempt = 0;
  const maxAttempts = 3;
  console.log(`[CheckLinkStatus] 🔍 Starting analysis for link: ${link.url}`);

  const { isValid, link: updatedLink } = await validateUrlAndTask(link);
  if (!isValid) return updatedLink;

  while (attempt < maxAttempts) {
    try {
      console.log(`[CheckLinkStatus] 🔄 Attempt ${attempt + 1}/${maxAttempts} to check link ${link.url}`);

      // Playwright: создаем контекст с user agent для ротации
      const selectedAgent = userAgents[attempt % userAgents.length];
      context = await createContext({ userAgent: selectedAgent.ua });
      page = await context.newPage();
      
      // Playwright: устанавливаем таймауты
      page.setDefaultNavigationTimeout(120000);
      page.setDefaultTimeout(120000);

      let response, loadTime, finalUrl;
      try {
        const navigationResult = await navigateToPage(page, link.url, selectedAgent);
        response = navigationResult.response;
        loadTime = navigationResult.loadTime;
        finalUrl = navigationResult.finalUrl;
        link.responseCode = response ? response.status().toString() : 'Timeout';
      } catch (error) {
        console.error(`Navigation failed for ${link.url}:`, error.message);
        link.status = error.message.includes('ERR_CERT') ? 'ssl-error' : 'timeout';
        link.errorDetails = error.message;
        link.isIndexable = false;
        link.indexabilityStatus = error.message.includes('ERR_CERT') ? 'ssl-error' : 'timeout';
        link.responseCode = 'Error';
        link.overallStatus = 'Problem';
        await link.save();
        return link;
      }

      const statusCode = response ? response.status() : null;
      if (statusCode) {
        if (statusCode === 500) {
          console.log(`Received 500 for ${link.url}, but will try to process content anyway`);
        } else if (statusCode === 304) {
          console.log(`Received 304 for ${link.url}, treating as successful`);
        } else if (statusCode === 302) {
          console.log(`Received 302 for ${link.url}, followed redirect to ${finalUrl}`);
          link.redirectUrl = finalUrl;
        } else if (statusCode === 418) {
          console.log(`Received 418 for ${link.url}, likely region restriction`);
          link.errorDetails = 'Region restriction (418)';
          link.status = 'broken';
          link.isIndexable = false;
          link.indexabilityStatus = 'region restriction';
          link.overallStatus = 'Problem';
          await link.save();
          return link;
        } else if (!response.ok() && ![302, 304].includes(statusCode)) {
          link.isIndexable = false;
          link.indexabilityStatus = `HTTP ${statusCode}`;
          link.status = statusCode >= 400 ? 'broken' : 'redirect';
          await link.save();
        }
      }

      const { isMetaRobotsFound, linksFound } = await extractPageData(page, link, response, loadTime, finalUrl);
      updateLinkStatus(link, isMetaRobotsFound, linksFound);

      await link.save();
      console.log(`[CheckLinkStatus] ✅ Finished analysis for link: ${link.url}, status: ${link.status}, overallStatus: ${link.overallStatus}`);
      return link;
    } catch (error) {
      console.error(`[CheckLinkStatus] ❌ Error on attempt ${attempt + 1} for ${link.url}:`, error.message);
      attempt++;
      if (attempt >= maxAttempts) {
        console.error(`[CheckLinkStatus] ⛔ Max attempts reached for ${link.url}, marking as broken`);
        link.status = 'broken';
        link.errorDetails = `Failed after ${maxAttempts} attempts: ${error.message}`;
        link.overallStatus = 'Problem';
        await link.save();
        return link;
      }
      if (context) {
        await closeContext(context);
        context = null;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
      if (page) {
        await page.close().catch(err => console.error(`[CheckLinkStatus] Error closing page for ${link.url}:`, err.message));
        page = null;
      }
      if (context) {
        await closeContext(context);
        context = null;
      }
      console.log(`[CheckLinkStatus] 🔒 Context closed for ${link.url}`);
    }
  }
};

const processLinksInBatches = async (links, batchSize = 10, projectId, wss, spreadsheetId, taskId) => {
  const { default: pLimitModule } = await import('p-limit');
  const pLimit = pLimitModule;
  const results = [];
  const totalLinks = links.length;

  console.log(`Starting processLinksInBatches: taskId=${taskId}, totalLinks=${totalLinks}`);

  const limit = pLimit(3);
  let processedLinks = 0;
  let totalProcessingTime = 0;

  if (!taskId) {
    console.log('processLinksInBatches: Task ID is missing, cancelling analysis');
    return results;
  }

  const task = await AnalysisTask.findById(taskId);
  if (!task) {
    console.log(`processLinksInBatches: Task ${taskId} not found during initialization, cancelling analysis`);
    return results;
  }

  await AnalysisTask.findByIdAndUpdate(taskId, {
    $set: {
      progress: 0,
      processedLinks: 0,
      totalLinks,
      estimatedTimeRemaining: 0,
    },
  });
  console.log(`Initialized progress for task ${taskId}: totalLinks=${totalLinks}`);

  for (let i = 0; i < totalLinks; i += batchSize) {
    const task = await AnalysisTask.findById(taskId);
    if (!task) {
      console.log(`processLinksInBatches: Task ${taskId} not found - analysis likely cancelled`);
      return results;
    }
    if (task.status === 'cancelled') {
      console.log(`processLinksInBatches: Task ${taskId} status is cancelled, stopping analysis`);
      return results;
    }

    const batch = links.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(totalLinks / batchSize)}: links ${i + 1} to ${Math.min(i + batchSize, totalLinks)}`);

    const memoryUsage = process.memoryUsage();
    console.log(`Memory usage before batch: RSS=${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB, HeapTotal=${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB, HeapUsed=${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    const startTime = Date.now();

    const batchResults = await Promise.all(
      batch.map(link => limit(async () => {
        console.log(`Starting analysis for link: ${link.url}`);
        try {
          const updatedLink = await checkLinkStatus(link);
          console.log(`Finished analysis for link: ${link.url}, status: ${updatedLink.status}, overallStatus: ${updatedLink.overallStatus}`);
          return updatedLink;
        } catch (error) {
          console.error(`Error processing link ${link.url}:`, error);
          link.status = 'broken';
          link.errorDetails = `Failed during analysis: ${error.message}`;
          link.overallStatus = 'Problem';

          const currentTask = await AnalysisTask.findById(taskId);
          if (!currentTask || currentTask.status === 'cancelled') {
            console.log(`processLinksInBatches: Task ${taskId} cancelled during link processing, skipping save for ${link.url}`);
            return link;
          }

          try {
            await link.save();
          } catch (saveError) {
            if (saveError.name === 'DocumentNotFoundError') {
              console.log(`processLinksInBatches: FrontendLink ${link._id} not found, likely deleted during cancellation`);
              return link;
            }
            throw saveError;
          }
          return link;
        }
      }))
    );

    processedLinks += batchResults.length;
    const batchTime = Date.now() - startTime;
    totalProcessingTime += batchTime;
    const avgTimePerLink = totalProcessingTime / processedLinks;
    const remainingLinks = totalLinks - processedLinks;
    const estimatedTimeRemaining = Math.round((remainingLinks * avgTimePerLink) / 1000);
    const progress = Math.round((processedLinks / totalLinks) * 100);

    const currentTask = await AnalysisTask.findById(taskId);
    if (!currentTask || currentTask.status === 'cancelled') {
      console.log(`processLinksInBatches: Task ${taskId} cancelled, skipping progress update`);
      return results;
    }

    await AnalysisTask.findByIdAndUpdate(taskId, {
      $set: {
        progress,
        processedLinks,
        totalLinks,
        estimatedTimeRemaining,
      },
    });
    console.log(`Updated progress for task ${taskId}: progress=${progress}%, processedLinks=${processedLinks}, totalLinks=${totalLinks}, estimatedTimeRemaining=${estimatedTimeRemaining}s`);

    results.push(...batchResults);
    console.log(`Batch completed: ${i + batch.length} of ${totalLinks} links processed`);

    const memoryUsageAfter = process.memoryUsage();
    console.log(`Memory usage after batch: RSS=${(memoryUsageAfter.rss / 1024 / 1024).toFixed(2)}MB, HeapTotal=${(memoryUsageAfter.heapTotal / 1024 / 1024).toFixed(2)}MB, HeapUsed=${(memoryUsageAfter.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    global.gc && global.gc();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const pendingLinks = await FrontendLink.find({ status: 'checking' });
  if (pendingLinks.length > 0) {
    console.log(`Found ${pendingLinks.length} links still in "checking" status after analysis. Updating...`);
    await Promise.all(pendingLinks.map(async (link) => {
      console.log(`Processing pending link: ${link.url}, userId=${link.userId}`);
      if (!link.userId) {
        console.error(`Link ${link.url} has no userId, deleting to avoid validation error`);
        await FrontendLink.deleteOne({ _id: link._id });
        return;
      }
      link.status = 'broken';
      link.errorDetails = 'Analysis incomplete: status not updated';
      link.overallStatus = 'Problem';
      try {
        await link.save();
      } catch (saveError) {
        if (saveError.name === 'DocumentNotFoundError') {
          console.log(`processLinksInBatches: FrontendLink ${link._id} not found during pending link update, likely deleted`);
        } else {
          throw saveError;
        }
      }
      console.log(`Updated link ${link.url} to status: broken`);
    }));
  }

  return results;
};

const checkLinks = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.userId;

  try {
    console.log(`[CheckLinks] 🔍 Starting manual links analysis for project ${projectId}`);
    
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.isAnalyzingManual) {
      return res.status(409).json({ error: 'Manual links analysis is already in progress for this project' });
    }

    const links = await FrontendLink.find({ projectId, userId, source: 'manual' });
    if (links.length === 0) {
      return res.status(400).json({ error: 'No links found to analyze' });
    }

    // Создаем задачу анализа
    const task = new AnalysisTask({
      projectId,
      userId,
      type: 'checkLinks',
      status: 'pending',
      totalLinks: links.length,
      processedLinks: 0,
      progress: 0,
      data: { userId, projectId },
    });
    await task.save();
    console.log(`[CheckLinks] ✅ Created analysis task ${task._id} with ${links.length} links`);

    // Обновляем пользователя
    const user = await User.findById(userId);
    user.activeTasks.set(projectId.toString(), task._id.toString());
    await user.save();

    // Обновляем ссылки с taskId
    await FrontendLink.updateMany(
      { projectId, userId, source: 'manual' },
      { $set: { taskId: task._id, status: 'pending' } }
    );
    console.log(`[CheckLinks] 📋 Updated ${links.length} links with taskId=${task._id}`);

    // Помечаем проект как анализируемый
    project.isAnalyzingManual = true;
    await project.save();

    // НОВОЕ: Добавляем задачи в BullMQ очередь
    const { addLinkAnalysisJobs, monitorTaskCompletion } = require('./taskQueue');
    const result = await addLinkAnalysisJobs(task._id, projectId, userId, 'manual');
    console.log(`[CheckLinks] ✅ Added ${result.added} jobs to BullMQ queue`);
    
    // Запускаем мониторинг завершения задачи
    monitorTaskCompletion(task._id, projectId, userId, 'manual');
    
    // Отправляем WebSocket событие о начале анализа
    const { broadcastAnalysisStarted } = require('../utils/websocketBroadcast');
    broadcastAnalysisStarted(projectId, task._id.toString());

    // Возвращаем успешный ответ сразу (задачи обрабатываются асинхронно)
    res.json({ 
      taskId: task._id, 
      message: 'Analysis started',
      totalLinks: links.length,
      queuedJobs: result.added,
    });
  } catch (error) {
    console.error('[CheckLinks] ❌ Error starting link check:', error.message);
    res.status(500).json({ error: 'Failed to start link check', details: error.message });
  }
};

// DEPRECATED: Старый код с analysisQueue.push() удален
// Теперь используется BullMQ через addLinkAnalysisJobs()

const getAnalysisStatus = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const tasks = await AnalysisTask.find({ projectId, status: { $in: ['pending', 'processing'] } });
    res.json({
      isAnalyzing: project.isAnalyzing,
      isAnalyzingManual: project.isAnalyzingManual,
      isAnalyzingSpreadsheet: project.isAnalyzingSpreadsheet,
      hasActiveTasks: tasks.length > 0,
    });
  } catch (error) {
    console.error('getAnalysisStatus: Error fetching analysis status', error);
    res.status(500).json({ error: 'Error fetching analysis status', details: error.message });
  }
};

const getTaskProgress = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.userId;

    const task = await AnalysisTask.findById(taskId);
    if (!task) {
      console.log(`getTaskProgress: Task ${taskId} not found`);
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.userId.toString() !== userId) {
      console.log(`getTaskProgress: Unauthorized access to task ${taskId} by user ${userId}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.json({
      progress: task.progress || 0,
      processedLinks: task.processedLinks || 0,
      totalLinks: task.totalLinks || 0,
      estimatedTimeRemaining: task.estimatedTimeRemaining || 0,
      status: task.status || 'pending',
    });
  } catch (error) {
    console.error('getTaskProgress: Error fetching task progress:', error);
    res.status(500).json({ error: 'Failed to fetch task progress', details: error.message });
  }
};

const getTaskProgressSSE = async (req, res) => {
  const { projectId, taskId } = req.params;
  const userId = req.userId;
  console.log(`SSE request for project ${projectId}, task ${taskId}, userId: ${userId}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const task = await AnalysisTask.findOne({ _id: taskId, projectId });
  if (!task) {
    console.log(`getTaskProgressSSE: Task ${taskId} not found for project ${projectId}`);
    res.write(`data: ${JSON.stringify({ error: 'Task not found' })}\n\n`);
    res.end();
    return;
  }

  if (task.userId.toString() !== userId) {
    console.log(`getTaskProgressSSE: Unauthorized access to task ${taskId} by user ${userId}`);
    res.write(`data: ${JSON.stringify({ error: 'Unauthorized' })}\n\n`);
    res.end();
    return;
  }

  res.write(`data: ${JSON.stringify({
    progress: task.progress,
    processedLinks: task.processedLinks,
    totalLinks: task.totalLinks,
    estimatedTimeRemaining: task.estimatedTimeRemaining,
    status: task.status,
  })}\n\n`);

  const intervalId = setInterval(async () => {
    const updatedTask = await AnalysisTask.findOne({ _id: taskId, projectId });
    if (!updatedTask) {
      console.log(`getTaskProgressSSE: Task ${taskId} no longer exists for project ${projectId}`);
      res.write(`data: ${JSON.stringify({ error: 'Task not found' })}\n\n`);
      clearInterval(intervalId);
      res.end();
      return;
    }

    console.log(`Sending SSE update for task ${taskId}: progress=${updatedTask.progress}%`);
    res.write(`data: ${JSON.stringify({
      progress: updatedTask.progress,
      processedLinks: updatedTask.processedLinks,
      totalLinks: updatedTask.totalLinks,
      estimatedTimeRemaining: updatedTask.estimatedTimeRemaining,
      status: updatedTask.status,
    })}\n\n`);

    if (updatedTask.status === 'completed' || updatedTask.status === 'failed' || updatedTask.status === 'cancelled') {
      console.log(`Task ${taskId} completed or failed, closing SSE connection`);
      clearInterval(intervalId);
      res.end();
    }
  }, 3000);

  req.on('close', () => {
    console.log(`SSE connection closed for task ${taskId}`);
    clearInterval(intervalId);
    res.end();
  });
};

const getActiveTasks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const tasks = await AnalysisTask.find({ projectId, status: { $in: ['pending', 'processing'] } });
    res.json({ activeTasks: tasks });
  } catch (error) {
    console.error('getActiveTasks: Error fetching active tasks', error);
    res.status(500).json({ error: 'Error fetching active tasks', details: error.message });
  }
};

const computeStatsForLinks = (links) => {
  const linkTypes = {
    dofollow: 0,
    nofollow: 0,
    unknown: 0,
  };
  links.forEach(link => {
    if (link.linkType === 'dofollow') linkTypes.dofollow++;
    else if (link.linkType === 'nofollow') linkTypes.nofollow++;
    else linkTypes.unknown++;
  });

  const statuses = {
    active: 0,
    broken: 0,
    timeout: 0,
    pending: 0,
    checking: 0,
  };
  links.forEach(link => {
    if (link.status === 'active') statuses.active++;
    else if (link.status === 'broken') statuses.broken++;
    else if (link.status === 'timeout') statuses.timeout++;
    else if (link.status === 'pending') statuses.pending++;
    else if (link.status === 'checking') statuses.checking++;
  });

  const responseCodes = {};
  links.forEach(link => {
    const code = link.responseCode || 'unknown';
    responseCodes[code] = (responseCodes[code] || 0) + 1;
  });

  const indexability = {
    indexable: 0,
    nonIndexable: 0,
    reasons: {},
  };
  links.forEach(link => {
    if (link.isIndexable === true) {
      indexability.indexable++;
    } else if (link.isIndexable === false) {
      indexability.nonIndexable++;
      const reason = link.indexabilityStatus || 'unknown';
      indexability.reasons[reason] = (indexability.reasons[reason] || 0) + 1;
    }
  });

  const loadTimes = links
    .filter(link => link.loadTime != null)
    .map(link => link.loadTime);
  const averageLoadTime = loadTimes.length > 0
    ? (loadTimes.reduce((sum, time) => sum + time, 0) / loadTimes.length / 1000).toFixed(2)
    : 0;

  return {
    linkTypes: {
      ...linkTypes,
      total: linkTypes.dofollow + linkTypes.nofollow + linkTypes.unknown,
      dofollowPercentage: linkTypes.dofollow + linkTypes.nofollow > 0
        ? ((linkTypes.dofollow / (linkTypes.dofollow + linkTypes.nofollow)) * 100).toFixed(2)
        : 0,
      nofollowPercentage: linkTypes.dofollow + linkTypes.nofollow > 0
        ? ((linkTypes.nofollow / (linkTypes.dofollow + linkTypes.nofollow)) * 100).toFixed(2)
        : 0,
    },
    statuses: {
      ...statuses,
      total: links.length,
    },
    responseCodes,
    indexability: {
      indexable: indexability.indexable,
      nonIndexable: indexability.nonIndexable,
      reasons: indexability.reasons,
      total: indexability.indexable + indexability.nonIndexable,
    },
    averageLoadTime: parseFloat(averageLoadTime),
  };
};

const getProjectStats = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.userId;
  const { source } = req.query; // Получаем параметр source из запроса

  try {
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // По умолчанию возвращаем статистику для manual, если source не указан
    const querySource = source || 'manual';
    const links = await FrontendLink.find({ projectId, source: querySource });

    // Вычисляем статистику для выбранного источника
    const stats = computeStatsForLinks(links);

    // Возвращаем статистику в старом формате
    res.json(stats);
  } catch (error) {
    console.error('getProjectStats: Error fetching project stats', error);
    res.status(500).json({ error: 'Error fetching project stats', details: error.message });
  }
};

module.exports = {
  checkLinkStatus,
  processLinksInBatches,
  checkLinks,
  getAnalysisStatus,
  getTaskProgress,
  getTaskProgressSSE,
  getActiveTasks,
  getProjectStats,
};