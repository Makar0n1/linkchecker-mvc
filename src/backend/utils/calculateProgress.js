const FrontendLink = require('../models/FrontendLink');

const calculateProgress = async (projectId, taskId, spreadsheetId = null) => {
  try {
    const query = { projectId, taskId };
    if (spreadsheetId) query.spreadsheetId = spreadsheetId;
    const links = await FrontendLink.find(query);
    if (links.length === 0) {
      return { progress: 100, processedLinks: 0, totalLinks: 0, estimatedTimeRemaining: 0, status: 'completed' };
    }

    const totalLinks = links.length;
    const processedLinks = links.filter(link => link.status !== 'pending').length;
    const progress = Math.round((processedLinks / totalLinks) * 100);
    const estimatedTimePerLink = 2;
    const estimatedTimeRemaining = (totalLinks - processedLinks) * estimatedTimePerLink;
    const status = progress === 100 ? 'completed' : 'pending';

    return { progress, processedLinks, totalLinks, estimatedTimeRemaining, status };
  } catch (error) {
    console.error('Error calculating progress:', error);
    return { progress: 0, processedLinks: 0, totalLinks: 0, estimatedTimeRemaining: 0, status: 'error', error: error.message };
  }
};

module.exports = { calculateProgress };