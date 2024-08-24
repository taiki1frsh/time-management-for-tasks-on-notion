# Time Management for Tasks on Notion

A simple node-js script automates schedule handling for a task management database on Notion with the record of tracking on Toggl. The script is intended to be run when the endpoint is accessed with the method of GET or POST.

The components of operations are:

1. Retrieve a single latest edited page from the specified database on Notion
1. Check if the status property of the page is checked
    1. If yes
        1. stop running Toggl time entry
        2. set current time in date property's end position
    1. If no,
        1. start a new Toggl time entry with title and tags from notion page
        1. set current time in date property's start position with the modifition of end so that the period of the task remains same
1. Return the success status code or else emit error msg with failure code

The whole operation code of modification to a Notion page is highly optimized for the structure of my own task management protocols and database properties.

It has been tested and works on Vercel.
