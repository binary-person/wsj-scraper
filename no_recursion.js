const puppeteer = require('puppeteer');
const request = require('request');
const getHrefs = require('get-hrefs');
var prompt = require('prompt-sync')();
const fs = require('fs');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getArticleLinks(html) {
    var linkArray = getHrefs(html);
    var links = [];
    for (var count = 0; count < linkArray.length; count++) {
        if (linkArray[count].split('wsj.com/')[1] && linkArray[count].split('wsj.com/')[1].split('/')[0] == 'articles') {
            links.push(linkArray[count].slice(0, 2) === '//' ? linkArray[count].split('?')[0].replace('//', 'https://') : linkArray[count].split('?')[0]);
        }
    }
    return links;
}

function getNewsLinks(html) {
    var linkArray = getHrefs(html);
    var links = [];
    for (var count = 0; count < linkArray.length; count++) {
        if (linkArray[count].split('wsj.com/')[1] && linkArray[count].split('wsj.com/')[1].split('/')[0] == 'news') {
            links.push(linkArray[count].slice(0, 2) === '//' ? linkArray[count].split('?')[0].replace('//', 'https://') : linkArray[count].split('?')[0]);
        }
    }
    return links;
}

function promiseRequest(url) {
    return new Promise((resolve) => {
        request(url, function(err, response, body) {
            if (err) {
                console.log(`Error occured while fetching URL ${url} : ${err}`);
                process.exit(1);
            }
            resolve(body);
        });
    });
}

function printProgress(progress) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(progress);
}


// Main
(async() => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    //Login
    await page.goto('https://accounts.wsj.com/login');
    var email = prompt('Enter your email: ');
    var pass = prompt.hide('Enter your password: ');
    await page.evaluate(function(email, pass) {
        document.getElementById('username').value = email;
        document.getElementById('password').value = pass;
        document.getElementsByClassName('solid-button basic-login-submit')[0].click();
    }, email, pass);
    sleep(4000);
    try {
        if (await page.evaluate(() => { return document.getElementsByClassName('username-error-container')[0].style.display }) !== 'none') {
            console.log('Login failed!');
            process.exit(1);
        }
    }
    catch (e) {}
    await page.waitForNavigation();

    async function getPDF(url, path) {
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 0
        });
        var pdf = await page.pdf({ margin: { top: "0.4in", right: "0.4in", bottom: "0.4in", left: "0.4in" } }); // {format: 'A4'}
        fs.writeFileSync(`${path}/${await page.title()}.pdf`, pdf);
    }


    //Get article list
    console.log('Getting news links');
    var listNews = getNewsLinks(await promiseRequest('https://wsj.com'));
    var articleList = [];
    console.log('Done getting news links. Getting articles within those news links');
    for (var countNews = 0; countNews < listNews.length; countNews++) {
        articleList = articleList.concat(await getArticleLinks(await promiseRequest(listNews[countNews])));
        printProgress(`${countNews+1} out of ${listNews.length} news links finished`);
    }
    console.log('\nDone. # of articles: ' + articleList.length);
    fs.writeFileSync('no_recursion_articles.json', JSON.stringify(articleList, null, 3), 'utf8');

    console.log('Saving all articles to PDF');
    //Download articles
    for (var articleCount = 0; articleCount < articleList.length; articleCount++) {
        await getPDF(articleList[articleCount], 'pdfs');
        printProgress(`Printed ${articleCount+1} out of ${articleList.length} articles`);
    }

    await browser.close();
})();
