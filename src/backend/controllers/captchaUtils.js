const cheerio = require('cheerio');
const axios = require('axios');

const detectCaptcha = async (page) => {
  const content = await page.evaluate(() => document.documentElement.outerHTML);
  const $ = cheerio.load(content);
  let captchaType = 'none';

  if ($('.cf-turnstile').length > 0) captchaType = 'Cloudflare Turnstile';
  else if ($('.g-recaptcha').length > 0) captchaType = 'Google reCAPTCHA';
  else if ($('.h-captcha').length > 0) captchaType = 'hCaptcha';
  else if ($('form[action*="/cdn-cgi/"]').length > 0) captchaType = 'Cloudflare Challenge Page';
  else if ($('div[id*="arkose"]').length > 0 || $('script[src*="arkoselabs"]').length > 0) captchaType = 'FunCaptcha';
  else if ($('div[class*="geetest"]').length > 0) captchaType = 'GeeTest';
  else if ($('img[src*="captcha"]').length > 0 || $('input[placeholder*="enter code"]').length > 0) captchaType = 'Image CAPTCHA';
  else if ($('body').text().toLowerCase().includes('verify you are not a robot')) captchaType = 'Custom CAPTCHA';
  else if ($('script[src*="keycaptcha"]').length > 0) captchaType = 'KeyCAPTCHA';
  else if ($('div[class*="capy"]').length > 0 || $('script[src*="capy"]').length > 0) captchaType = 'Capy Puzzle CAPTCHA';
  else if ($('div[id*="lemin-cropped-captcha"]').length > 0) captchaType = 'Lemin CAPTCHA';
  else if ($('script[src*="awswaf"]').length > 0) captchaType = 'Amazon CAPTCHA';
  else if ($('script[src*="cybersiara"]').length > 0 || $('div[class*="cybersiara"]').length > 0) captchaType = 'CyberSiARA';
  else if ($('script[src*="mtcaptcha"]').length > 0) captchaType = 'MTCaptcha';
  else if ($('div[class*="cutcaptcha"]').length > 0) captchaType = 'Cutcaptcha';
  else if ($('div[class*="frc-captcha"]').length > 0 || $('script[src*="friendlycaptcha"]').length > 0) captchaType = 'Friendly Captcha';
  else if ($('script[src*="aisecurius"]').length > 0) captchaType = 'atbCAPTCHA';
  else if ($('script[src*="tencent"]').length > 0 || $('div[id*="TencentCaptcha"]').length > 0) captchaType = 'Tencent';
  else if ($('script[src*="prosopo"]').length > 0) captchaType = 'Prosopo Procaptcha';
  else if ($('div[class*="captcha"]').length > 0 && $('span[class*="rotate"]').length > 0) captchaType = 'Rotate CAPTCHA';
  else if ($('div[class*="captcha"]').length > 0 && $('div[class*="grid"]').length > 0) captchaType = 'Grid CAPTCHA';
  else if ($('div[class*="captcha"]').length > 0 && $('canvas').length > 0) captchaType = 'Draw Around CAPTCHA';
  else if ($('div[class*="captcha"]').length > 0 && $('div[class*="bounding-box"]').length > 0) captchaType = 'Bounding Box CAPTCHA';
  else if ($('audio[src*="captcha"]').length > 0 || $('div[class*="audio-captcha"]').length > 0) captchaType = 'Audio CAPTCHA';
  else if ($('div[class*="captcha"]').length > 0 && $('input[type="text"]').length > 0 && $('body').text().toLowerCase().includes('solve')) captchaType = 'Text CAPTCHA';

  const currentPageUrl = await page.url();
  if (captchaType !== 'none') console.log(`CAPTCHA detected on ${currentPageUrl}: ${captchaType}`);
  return { type: captchaType, currentPageUrl };
};

const solveCaptcha = async (task, maxRetries = 2) => {
  let retry = 0;
  while (retry <= maxRetries) {
    try {
      const createTaskResponse = await axios.post('https://api.2captcha.com/createTask', {
        clientKey: process.env.TWOCAPTCHA_API_KEY,
        task: task,
      });
      console.log(`2Captcha createTask response:`, createTaskResponse.data);

      if (createTaskResponse.data.errorId !== 0) {
        throw new Error(`2Captcha createTask error: ${createTaskResponse.data.errorDescription}`);
      }

      const taskId = createTaskResponse.data.taskId;

      let result;
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const resultResponse = await axios.post('https://api.2captcha.com/getTaskResult', {
          clientKey: process.env.TWOCAPTCHA_API_KEY,
          taskId: taskId,
        });
        result = resultResponse.data;
        console.log(`2Captcha task status for task ${taskId}:`, result);
        if (result.status === 'ready') break;
        if (result.status === 'failed' || result.errorId) {
          throw new Error(`2Captcha task failed: ${result.errorDescription || 'Unknown error'}`);
        }
      }

      if (!result.solution) {
        throw new Error('No solution returned from 2Captcha');
      }

      return result.solution;
    } catch (error) {
      retry++;
      if (retry > maxRetries) {
        console.error(`Max retries reached for CAPTCHA solving: ${error.message}`);
        throw error;
      }
      console.log(`Retrying CAPTCHA solve (attempt ${retry + 1}) after error:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

const handleCaptcha = async (page, captchaType, currentPageUrl) => {
  let captchaToken = null;
  let content = null;

  if (captchaType === 'Google reCAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('.g-recaptcha').attr('data-sitekey');
    if (!sitekey) throw new Error('Could not extract sitekey for Google reCAPTCHA');
    console.log(`Extracted sitekey for Google reCAPTCHA: ${sitekey}`);

    const task = {
      type: 'RecaptchaV2TaskProxyless',
      websiteURL: currentPageUrl,
      websiteKey: sitekey,
      isInvisible: false,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.gRecaptchaResponse;
    console.log(`Google reCAPTCHA solved: ${captchaToken.substring(0, 20)}...`);

    const textareaExists = await page.evaluate(() => !!document.querySelector('#g-recaptcha-response'));
    if (!textareaExists) {
      console.error('No g-recaptcha-response textarea found');
      throw new Error('No g-recaptcha-response textarea found');
    }

    await page.evaluate(token => {
      const textarea = document.querySelector('#g-recaptcha-response');
      if (textarea) textarea.innerHTML = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Google reCAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Cloudflare Turnstile') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('.cf-turnstile').attr('data-sitekey');
    if (!sitekey) throw new Error('Could not extract sitekey for Cloudflare Turnstile');
    console.log(`Extracted sitekey for Cloudflare Turnstile: ${sitekey}`);

    const task = {
      type: 'TurnstileTaskProxyless',
      websiteURL: currentPageUrl,
      websiteKey: sitekey,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`Cloudflare Turnstile solved: ${captchaToken}`);

    const inputExists = await page.evaluate(() => !!document.querySelector('input[name="cf-turnstile-response"]'));
    if (!inputExists) {
      console.error('No cf-turnstile-response input found');
      throw new Error('No cf-turnstile-response input found');
    }

    await page.evaluate(token => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Cloudflare Turnstile, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'hCaptcha') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('.h-captcha').attr('data-sitekey');
    if (!sitekey) throw new Error('Could not extract sitekey for hCaptcha');
    console.log(`Extracted sitekey for hCaptcha: ${sitekey}`);

    const task = {
      type: 'HCaptchaTaskProxyless',
      websiteURL: currentPageUrl,
      websiteKey: sitekey,
      isInvisible: $('.h-captcha').hasClass('visible') ? false : true,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.gRecaptchaResponse;
    console.log(`hCaptcha solved: ${captchaToken.substring(0, 20)}...`);

    const textareaExists = await page.evaluate(() => !!document.querySelector('#h-captcha-response'));
    if (!textareaExists) {
      console.error('No h-captcha-response textarea found');
      throw new Error('No h-captcha-response textarea found');
    }

    await page.evaluate(token => {
      const textarea = document.querySelector('#h-captcha-response');
      if (textarea) textarea.innerHTML = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for hCaptcha, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'FunCaptcha') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('script[src*="arkoselabs"]').attr('src')?.match(/pk=([^&]+)/)?.[1];
    if (!sitekey) throw new Error('Could not extract sitekey for FunCaptcha');
    console.log(`Extracted publickey for FunCaptcha: ${sitekey}`);

    const apiSubdomain = $('script[src*="arkoselabs"]').attr('src') ? new URL($('script[src*="arkoselabs"]').attr('src')).hostname : null;

    const task = {
      type: 'FunCaptchaTaskProxyless',
      websiteURL: currentPageUrl,
      websitePublicKey: sitekey,
      funcaptchaApiJSSubdomain: apiSubdomain || 'client-api.arkoselabs.com',
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`FunCaptcha solved: ${captchaToken}`);

    const inputExists = await page.evaluate(() => !!document.querySelector('input[name="fc-token"]'));
    if (!inputExists) {
      console.error('No fc-token input found');
      throw new Error('No fc-token input found');
    }

    await page.evaluate(token => {
      const input = document.querySelector('input[name="fc-token"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for FunCaptcha, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'GeeTest') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const geeTestParams = $('script[src*="geetest"]')?.attr('src')?.match(/gt=([^&]+)/)?.[1];
    const challenge = $('script[src*="geetest"]')?.attr('src')?.match(/challenge=([^&]+)/)?.[1];
    if (!geeTestParams || !challenge) throw new Error('Could not extract parameters for GeeTest');
    console.log(`Extracted parameters for GeeTest: gt=${geeTestParams}, challenge=${challenge}`);

    const task = {
      type: 'GeeTestTaskProxyless',
      websiteURL: currentPageUrl,
      gt: geeTestParams,
      challenge: challenge,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution;
    console.log(`GeeTest solved: ${JSON.stringify(captchaToken)}`);

    await page.evaluate(params => {
      Object.keys(params).forEach(key => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = params[key];
        document.forms[0]?.appendChild(input);
      });
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for GeeTest, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Image CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const captchaImageUrl = $('img[src*="captcha"]').attr('src');
    if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL');
    console.log(`Extracted CAPTCHA image URL: ${captchaImageUrl}`);

    const task = {
      type: 'ImageToTextTask',
      body: captchaImageUrl,
      phrase: false,
      case: true,
      numeric: 0,
      math: false,
      minLength: 1,
      maxLength: 5,
      comment: 'enter the text you see on the image',
      languagePool: 'en',
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.text;
    console.log(`Image CAPTCHA solved: ${captchaToken}`);

    const inputExists = await page.evaluate(() => !!document.querySelector('input[placeholder*="enter code"], input[name*="captcha"]'));
    if (!inputExists) {
      console.error('No input field found for Image CAPTCHA');
      throw new Error('No input field found for Image CAPTCHA');
    }

    await page.type('input[placeholder*="enter code"], input[name*="captcha"]', captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Image CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Custom CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const captchaImageUrl = $('img[src*="captcha"]').attr('src');
    if (!captchaImageUrl) throw new Error('Custom CAPTCHA not supported for automated solving');
    console.log(`Extracted CAPTCHA image URL for Custom CAPTCHA: ${captchaImageUrl}`);

    const task = {
      type: 'ImageToTextTask',
      body: captchaImageUrl,
      phrase: false,
      case: true,
      numeric: 0,
      math: false,
      minLength: 1,
      maxLength: 5,
      comment: 'enter the text you see on the image',
      languagePool: 'en',
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.text;
    console.log(`Custom CAPTCHA (Image) solved: ${captchaToken}`);

    const inputExists = await page.evaluate(() => !!document.querySelector('input[placeholder*="enter code"], input[name*="captcha"]'));
    if (!inputExists) {
      console.error('No input field found for Custom CAPTCHA');
      throw new Error('No input field found for Custom CAPTCHA');
    }

    await page.type('input[placeholder*="enter code"], input[name*="captcha"]', captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Custom CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'KeyCAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const keyCaptchaParams = {
      s_s_c_user_id: $('input[name="s_s_c_user_id"]').val(),
      s_s_c_session_id: $('input[name="s_s_c_session_id"]').val(),
      s_s_c_web_server_sign: $('input[name="s_s_c_web_server_sign"]').val(),
      s_s_c_web_server_sign2: $('input[name="s_s_c_web_server_sign2"]').val(),
    };
    if (!keyCaptchaParams.s_s_c_user_id || !keyCaptchaParams.s_s_c_session_id || !keyCaptchaParams.s_s_c_web_server_sign || !keyCaptchaParams.s_s_c_web_server_sign2) {
      throw new Error('Could not extract parameters for KeyCAPTCHA');
    }
    console.log(`Extracted parameters for KeyCAPTCHA:`, keyCaptchaParams);

    const task = {
      type: 'KeyCaptchaTaskProxyless',
      s_s_c_user_id: keyCaptchaParams.s_s_c_user_id,
      s_s_c_session_id: keyCaptchaParams.s_s_c_session_id,
      s_s_c_web_server_sign: keyCaptchaParams.s_s_c_web_server_sign,
      s_s_c_web_server_sign2: keyCaptchaParams.s_s_c_web_server_sign2,
      websiteURL: currentPageUrl,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`KeyCAPTCHA solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="kc-response"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for KeyCAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Capy Puzzle CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('script[src*="capy"]')?.attr('src')?.match(/sitekey=([^&]+)/)?.[1];
    if (!sitekey) throw new Error('Could not extract sitekey for Capy Puzzle CAPTCHA');
    console.log(`Extracted sitekey for Capy Puzzle CAPTCHA: ${sitekey}`);

    const task = {
      type: 'CapyTaskProxyless',
      websiteURL: currentPageUrl,
      websiteKey: sitekey,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`Capy Puzzle CAPTCHA solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="capy-token"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Capy Puzzle CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Lemin CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const captchaId = $('#lemin-cropped-captcha')?.attr('data-captcha-id');
    const divId = 'lemin-cropped-captcha';
    const apiServer = $('script[src*="leminnow"]')?.attr('src') ? new URL($('script[src*="leminnow"]').attr('src')).hostname : null;
    if (!captchaId || !divId) throw new Error('Could not extract parameters for Lemin CAPTCHA');
    console.log(`Extracted parameters for Lemin CAPTCHA: captchaId=${captchaId}, divId=${divId}`);

    const task = {
      type: 'LeminTaskProxyless',
      captchaId: captchaId,
      divId: divId,
      leminApiServerSubdomain: apiServer || 'api.leminnow.com',
      websiteURL: currentPageUrl,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`Lemin CAPTCHA solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="lemin-token"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Lemin CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Amazon CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const params = {
      challengeScript: $('script[src*="awswaf"]')?.attr('src'),
      captchaScript: $('script[src*="captcha.awswaf"]')?.attr('src'),
      websiteKey: $('input[name="aws-waf-token"]')?.val(),
      context: $('input[name="context"]')?.val(),
      iv: $('input[name="iv"]')?.val(),
    };
    if (!params.challengeScript || !params.captchaScript || !params.websiteKey || !params.context || !params.iv) {
      throw new Error('Could not extract parameters for Amazon CAPTCHA');
    }
    console.log(`Extracted parameters for Amazon CAPTCHA:`, params);

    const task = {
      type: 'AmazonTaskProxyless',
      websiteURL: currentPageUrl,
      challengeScript: params.challengeScript,
      captchaScript: params.captchaScript,
      websiteKey: params.websiteKey,
      context: params.context,
      iv: params.iv,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`Amazon CAPTCHA solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="aws-waf-token"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Amazon CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'CyberSiARA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const slideMasterUrlId = $('script[src*="cybersiara"]')?.attr('src')?.match(/slideMasterUrlId=([^&]+)/)?.[1];
    if (!slideMasterUrlId) throw new Error('Could not extract SlideMasterUrlId for CyberSiARA');
    console.log(`Extracted SlideMasterUrlId for CyberSiARA: ${slideMasterUrlId}`);

    const task = {
      type: 'AntiCyberSiAraTaskProxyless',
      websiteURL: currentPageUrl,
      SlideMasterUrlId: slideMasterUrlId,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`CyberSiARA solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="cybersiara-token"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for CyberSiARA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'MTCaptcha') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('script[src*="mtcaptcha"]')?.attr('data-sitekey');
    if (!sitekey) throw new Error('Could not extract sitekey for MTCaptcha');
    console.log(`Extracted sitekey for MTCaptcha: ${sitekey}`);

    const task = {
      type: 'MtCaptchaTaskProxyless',
      websiteURL: currentPageUrl,
      websiteKey: sitekey,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`MTCaptcha solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="mtcaptcha-token"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for MTCaptcha, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Cutcaptcha') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const miseryKey = $('div[class*="cutcaptcha"]').attr('data-misery-key');
    const apiKey = $('div[class*="cutcaptcha"]').attr('data-api-key');
    if (!miseryKey || !apiKey) throw new Error('Could not extract parameters for Cutcaptcha');
    console.log(`Extracted parameters for Cutcaptcha: miseryKey=${miseryKey}, apiKey=${apiKey}`);

    const task = {
      type: 'CutCaptchaTaskProxyless',
      miseryKey: miseryKey,
      apiKey: apiKey,
      websiteURL: currentPageUrl,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`Cutcaptcha solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input#cap_token');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Cutcaptcha, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Friendly Captcha') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('div[class*="frc-captcha"]').attr('data-sitekey');
    if (!sitekey) throw new Error('Could not extract sitekey for Friendly Captcha');
    console.log(`Extracted sitekey for Friendly Captcha: ${sitekey}`);

    const task = {
      type: 'FriendlyCaptchaTaskProxyless',
      websiteURL: currentPageUrl,
      websiteKey: sitekey,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`Friendly Captcha solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="frc-captcha-response"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Friendly Captcha, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'atbCAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const appId = $('script[src*="aisecurius"]')?.attr('src')?.match(/appId=([^&]+)/)?.[1];
    const apiServer = $('script[src*="aisecurius"]').attr('src') ? new URL($('script[src*="aisecurius"]').attr('src')).hostname : null;
    if (!appId || !apiServer) throw new Error('Could not extract parameters for atbCAPTCHA');
    console.log(`Extracted parameters for atbCAPTCHA: appId=${appId}, apiServer=${apiServer}`);

    const task = {
      type: 'AtbCaptchaTaskProxyless',
      appId: appId,
      apiServer: apiServer || 'https://cap.aisecurius.com',
      websiteURL: currentPageUrl,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`atbCAPTCHA solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="atb-captcha-response"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for atbCAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Tencent') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const appId = $('#TencentCaptcha')?.attr('data-appid');
    if (!appId) throw new Error('Could not extract appId for Tencent CAPTCHA');
    console.log(`Extracted appId for Tencent CAPTCHA: ${appId}`);

    const task = {
      type: 'TencentTaskProxyless',
      appId: appId,
      websiteURL: currentPageUrl,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.ticket;
    console.log(`Tencent CAPTCHA solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="tencent-ticket"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Tencent CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Prosopo Procaptcha') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('script[src*="prosopo"]')?.attr('src')?.match(/sitekey=([^&]+)/)?.[1];
    if (!sitekey) throw new Error('Could not extract sitekey for Prosopo Procaptcha');
    console.log(`Extracted sitekey for Prosopo Procaptcha: ${sitekey}`);

    const task = {
      type: 'ProsopoTaskProxyless',
      websiteKey: sitekey,
      websiteURL: currentPageUrl,
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.token;
    console.log(`Prosopo Procaptcha solved: ${captchaToken}`);

    await page.evaluate(token => {
      const input = document.querySelector('input[name="prosopo-token"]');
      if (input) input.value = token;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Prosopo Procaptcha, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Cloudflare Challenge Page') {
    await page.waitForSelector('input[name="cf_captcha_kind"]', { timeout: 10000 });
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const sitekey = $('input[name="cf_captcha_kind"]').attr('data-sitekey');
    if (sitekey) {
      console.log(`Extracted sitekey for Cloudflare Challenge Page: ${sitekey}`);

      const task = {
        type: 'TurnstileTaskProxyless',
        websiteURL: currentPageUrl,
        websiteKey: sitekey,
      };

      const solution = await solveCaptcha(task);
      captchaToken = solution.token;
      console.log(`Cloudflare Challenge Page solved: ${captchaToken}`);

      const inputExists = await page.evaluate(() => !!document.querySelector('input[name="cf-turnstile-response"]'));
      if (!inputExists) {
        console.error('No cf-turnstile-response input found');
        throw new Error('No cf-turnstile-response input found');
      }

      await page.evaluate(token => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        if (input) input.value = token;
      }, captchaToken);

      const submitButton = await page.$('button[type="submit"], input[type="submit"]');
      if (submitButton) {
        const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
        await submitButton.click();
        await navigationPromise;
        content = await page.evaluate(() => document.documentElement.outerHTML);
      } else {
        console.log('No submit button found for Cloudflare Challenge Page, assuming token submission via JavaScript');
        await page.evaluate(() => {
          const form = document.querySelector('form');
          if (form) form.submit();
        });
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
        content = await page.evaluate(() => document.documentElement.outerHTML);
      }
    } else {
      console.log('Cloudflare Challenge Page does not require CAPTCHA solving, waiting for redirect...');
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Text CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const comment = $('div[class*="captcha"]').text().match(/If tomorrow is \w+, what day is today\?/)?.[0];
    if (!comment) throw new Error('Could not extract text for Text CAPTCHA');
    console.log(`Extracted comment for Text CAPTCHA: ${comment}`);

    const task = {
      type: 'TextCaptchaTask',
      comment: comment,
      languagePool: 'en',
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.text;
    console.log(`Text CAPTCHA solved: ${captchaToken}`);

    const inputExists = await page.evaluate(() => !!document.querySelector('input[type="text"]'));
    if (!inputExists) {
      console.error('No input field found for Text CAPTCHA');
      throw new Error('No input field found for Text CAPTCHA');
    }

    await page.type('input[type="text"]', captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Text CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Rotate CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const captchaImageUrl = $('img[src*="captcha"]').attr('src');
    if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Rotate CAPTCHA');
    console.log(`Extracted CAPTCHA image URL for Rotate CAPTCHA: ${captchaImageUrl}`);

    const task = {
      type: 'RotateTask',
      body: captchaImageUrl,
      comment: 'position the image properly',
      angle: 60,
      languagePool: 'en',
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.angle;
    console.log(`Rotate CAPTCHA solved: Angle ${captchaToken}`);

    await page.evaluate(angle => {
      const img = document.querySelector('img[src*="captcha"]');
      if (img) img.style.transform = `rotate(${angle}deg)`;
    }, captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Rotate CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Grid CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const captchaImageUrl = $('img[src*="captcha"]').attr('src');
    if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Grid CAPTCHA');
    console.log(`Extracted CAPTCHA image URL for Grid CAPTCHA: ${captchaImageUrl}`);

    const gridDimensions = $('div[class*="grid"]').attr('data-rows') ? {
      rows: parseInt($('div[class*="grid"]').attr('data-rows')) || 4,
      columns: parseInt($('div[class*="grid"]').attr('data-columns')) || 4,
    } : { rows: 4, columns: 4 };

    const task = {
      type: 'GridTask',
      body: captchaImageUrl,
      comment: 'select all vehicles',
      rows: gridDimensions.rows,
      columns: gridDimensions.columns,
    };

    const solution = await solveCaptcha(task);
    const selectedCells = solution.cells;
    console.log(`Grid CAPTCHA solved: Selected cells ${JSON.stringify(selectedCells)}`);

    await page.evaluate(cells => {
      cells.forEach(cellIndex => {
        const cell = document.querySelector(`div[class*="grid"] div:nth-child(${cellIndex + 1})`);
        if (cell) cell.click();
      });
    }, selectedCells);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Grid CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Draw Around CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const captchaImageUrl = $('img[src*="captcha"]').attr('src');
    if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Draw Around CAPTCHA');
    console.log(`Extracted CAPTCHA image URL for Draw Around CAPTCHA: ${captchaImageUrl}`);

    const task = {
      type: 'DrawAroundTask',
      body: captchaImageUrl,
      comment: 'draw around an apple',
      languagePool: 'en',
    };

    const solution = await solveCaptcha(task);
    const path = solution.path;
    console.log(`Draw Around CAPTCHA solved: Path ${JSON.stringify(path)}`);

    await page.evaluate(path => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        path.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      }
    }, path);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Draw Around CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Bounding Box CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const captchaImageUrl = $('img[src*="captcha"]').attr('src');
    if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Bounding Box CAPTCHA');
    console.log(`Extracted CAPTCHA image URL for Bounding Box CAPTCHA: ${captchaImageUrl}`);

    const task = {
      type: 'BoundingBoxTask',
      body: captchaImageUrl,
      comment: 'draw a tight box around the green apple',
    };

    const solution = await solveCaptcha(task);
    const boundingBox = solution.coordinates;
    console.log(`Bounding Box CAPTCHA solved: Coordinates ${JSON.stringify(boundingBox)}`);

    await page.evaluate(box => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.width, box.height);
        ctx.stroke();
      }
    }, boundingBox);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Bounding Box CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else if (captchaType === 'Audio CAPTCHA') {
    const $ = cheerio.load(await page.evaluate(() => document.documentElement.outerHTML));
    const audioUrl = $('audio[src*="captcha"]').attr('src');
    if (!audioUrl) throw new Error('Could not extract audio URL for Audio CAPTCHA');
    console.log(`Extracted audio URL for Audio CAPTCHA: ${audioUrl}`);

    const task = {
      type: 'AudioTask',
      body: audioUrl,
      lang: 'en',
    };

    const solution = await solveCaptcha(task);
    captchaToken = solution.text;
    console.log(`Audio CAPTCHA solved: ${captchaToken}`);

    const inputExists = await page.evaluate(() => !!document.querySelector('input[type="text"]'));
    if (!inputExists) {
      console.error('No input field found for Audio CAPTCHA');
      throw new Error('No input field found for Audio CAPTCHA');
    }

    await page.type('input[type="text"]', captchaToken);

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      await submitButton.click();
      await navigationPromise;
      content = await page.evaluate(() => document.documentElement.outerHTML);
    } else {
      console.log('No submit button found for Audio CAPTCHA, assuming token submission via JavaScript');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 });
      content = await page.evaluate(() => document.documentElement.outerHTML);
    }
  } else {
    content = await page.evaluate(() => document.documentElement.outerHTML);
  }

  return { captchaToken, content };
};

module.exports = {
  detectCaptcha,
  solveCaptcha,
  handleCaptcha,
};