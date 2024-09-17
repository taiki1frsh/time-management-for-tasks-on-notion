import { Client } from "@notionhq/client";
import { DateTime } from "luxon";
const https = require('https');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const TOGGL_API_TOKEN = process.env.TOGGL_API_TOKEN;
const TOGGL_WORKSPACE_ID = process.env.TOGGL_WORKSPACE_ID;
const databaseId = process.env.NOTION_DATABASE_TASK_MANAGER_ID;

// The prop name has date type which defines the schedule of the task
const date_prop_name = "Schedule"
// The prop name has number type which reflects consumed time for a task
const number_prop_name = "Spent"
// The prop name has title attribute and text type
const title_prop_name = "Question / Task"
// The prop name has multi-select type which defines task classes
const multi_select_prop_name = "PJ Tags"

// Time Zone you belong and set as default in Notion
const time_zone = "Asia/Tokyo"


export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // By using last_edited_time, get a single page with Notion API
  const pagesStream = await notion.databases.query({
    database_id: databaseId,
    sorts: [
      {
        timestamp: "last_edited_time",
        direction: "descending",
      },
    ],
    page_size: 1,
  });

  for (const page of pagesStream.results) {
    const statusProperty = page.properties?.["Status"];
    console.log('')
    
    if (statusProperty?.checkbox) { // Set current time as date.end and stop running Toggl time entry
      try {
        const currentTimeEntry = await getCurrentTimeEntry();
        
        if (currentTimeEntry?.id) {
          await stopTimeEntry(currentTimeEntry.id);

          const start_time = page.properties?.[date_prop_name].date.start;
          await updateScheduleDateEndTime(page.id, start_time);

          res.status(200).json({ message: 'FINISHED: Toggl time entry stopped.' });
        } else {
          res.status(200).json({ message: 'No running time entry found.' });
        }
      } catch (error) {
        console.error("Error stopping Toggl time entry:", error);
        res.status(500).json({ message: 'Failed to stop time entry', error });
      }
    } else {  // Set current time as date.start data and start a new time entry in Toggl with tags
      const togglResponse = await startTogglTimeEntry(page);

      await updateScheduleDateStartTime(page.id, 0, page);
      
      res.status(200).json({ message: 'STARTED: Notion page updates processed and Toggl time entry started.' });
    }
  }
}

async function startTogglTimeEntry(page) {
  return new Promise((resolve, reject) => {
    const description = page.properties?.[title_prop_name].title[0]?.plain_text || "No Description";
    const now = new Date().toISOString().split(".")[0] + "Z"; // Remove milli seconds for UTC format
    const workspaceId = parseInt(TOGGL_WORKSPACE_ID, 10);
    const tags = page.properties?.[multi_select_prop_name]?.multi_select?.map(tag => tag.name) || [];

    const data = JSON.stringify({
        description: description,
        created_with: "notion",
        billable: false,
        start: now,
        duration: -1, // start time entry
        wid: workspaceId,
        tags: tags,
    });

    const options = {
      hostname: 'api.track.toggl.com',
      path: `/api/v9/workspaces/${TOGGL_WORKSPACE_ID}/time_entries`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${TOGGL_API_TOKEN}:api_token`).toString('base64')}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsedData = JSON.parse(body);
            resolve(parsedData);
          } catch (error) {
            reject(new Error('Failed to parse Toggl API response'));
          }
        } else {
          reject(new Error(`Toggl API request failed with status code ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(data);
    req.end();
  });
}

async function getCurrentTimeEntry() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.track.toggl.com',
      path: '/api/v9/me/time_entries/current',
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${TOGGL_API_TOKEN}:api_token`).toString('base64')}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsedData = JSON.parse(body);
            resolve(parsedData);
          } catch (error) {
            reject(new Error('Failed to parse Toggl API response'));
          }
        } else {
          reject(new Error(`Toggl API request failed with status code ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

async function stopTimeEntry(timeEntryId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      stop: new Date().toISOString().split(".")[0] + "Z"
    });

    const options = {
      hostname: 'api.track.toggl.com',
      path: `/api/v9/workspaces/${TOGGL_WORKSPACE_ID}/time_entries/${timeEntryId}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${TOGGL_API_TOKEN}:api_token`).toString('base64')}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsedData = JSON.parse(body);
            resolve(parsedData);
          } catch (error) {
            reject(new Error('Failed to parse Toggl API response'));
          }
        } else {
          reject(new Error(`Toggl API request failed with status code ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(data);
    req.end();
  });
}

async function updateScheduleDateStartTime(pageId, togglEntryId, page) {
  const now = DateTime.now().setZone(time_zone).toISO({ includeOffset: true });
  const spentHours = page.properties[number_prop_name]?.formula.number || 0;
   
  const endTime = DateTime.fromISO(now)
    .plus({ hours: spentHours }).setZone(time_zone).toISO({ includeOffset: true });
  
  try {    
    const response = await notion.pages.update({
        page_id: pageId,
        properties: {
            [date_prop_name]: {
            date: {
                start: now,
                end: endTime
            },
            },
        },
    });
    return response;
  } catch (error) {
    console.error("Error updating Notion page:", error);
    res.status(500).json({ message: 'Failed to update page', error });    
  }
}

async function updateScheduleDateEndTime(pageId, start_time) {
  const now = DateTime.now().setZone(time_zone).toISO({ includeOffset: true });  

  try {
    const response = await notion.pages.update({
      page_id: pageId,
      properties: {
        [date_prop_name]: {
          date: {
            start: start_time, // Inherit start time so that updaing succeeds
            end: now, // Set end to current time
          },
        },
      },
    });
    return response;
  } catch (error) {
    console.error("Error updating Schedule Date:", error);
    throw new Error('Failed to update Schedule Date end time');
  }
}

