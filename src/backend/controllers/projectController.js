const Project = require('../models/Project');
const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');

const createProject = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });

  try {
    const project = new Project({
      name,
      userId: req.userId,
      links: [],
    });
    await project.save();
    res.status(201).json(project);
  } catch (error) {
    console.error('createProject: Error creating project', error);
    res.status(500).json({ error: 'Error creating project', details: error.message });
  }
};

const getProjects = async (req, res) => {
  try {
    const projects = await Project.find({ userId: req.userId });
    res.json(projects);
  } catch (error) {
    console.error('getProjects: Error fetching projects', error);
    res.status(500).json({ error: 'Error fetching projects', details: error.message });
  }
};

const deleteProject = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await FrontendLink.deleteMany({ projectId });
    await Spreadsheet.deleteMany({ projectId });
    await Project.deleteOne({ _id: projectId, userId: req.userId });
    res.json({ message: 'Project deleted' });
  } catch (error) {
    console.error('deleteProject: Error deleting project', error);
    res.status(500).json({ error: 'Error deleting project', details: error.message });
  }
};

module.exports = {
  createProject,
  getProjects,
  deleteProject,
};